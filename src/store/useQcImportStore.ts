import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { validateRow } from '@/lib/shared/excelTemplate';
import { recordFieldVerification, type PendingCorrection } from '@/lib/shared/fieldCorrections.client';
import { MIN_PATTERN_EVIDENCE } from '@/lib/shared/learningConfig';
import { recordModelBrandMatch } from '@/lib/shared/modelBrandIndex.client';
import type { GroupedModelRow } from '@/lib/qc-extract/types';

/**
 * The "learning" half of what used to also submit to the CRM — QC Import
 * never does that anymore (see useQcImportStore doc comment below), so
 * this is now the ONLY thing that happens on Verify & Learn / before a
 * download. Safe to call freely: Pick's options always come from the
 * live CRM dropdown, so a Picked value is already proven correct against
 * real data regardless of what happens to the row afterward.
 */
export interface LearningSummary {
  exactLearned: number;
  patternsActivated: number;
  patternsBuildingEvidence: number;
}

async function flushLearning(
  groups: GroupedModelRow[],
  pendingCorrections: PendingCorrection[]
): Promise<LearningSummary> {
  const summary: LearningSummary = { exactLearned: 0, patternsActivated: 0, patternsBuildingEvidence: 0 };

  if (pendingCorrections.length > 0) {
    const deduped = new Map<string, PendingCorrection>();
    pendingCorrections.forEach((c) => deduped.set(`${c.field}:${c.scope}:${c.rawValue}`, c));
    const results = await Promise.all(
      Array.from(deduped.values()).map((c) => recordFieldVerification(c.field, c.scope, c.rawValue, c.correctValue))
    );
    for (const r of results) {
      if (!r) continue;
      if (r.storedExact && !r.storedPattern) summary.exactLearned += 1;
      if (r.storedPattern) {
        if (r.patternJustActivated) summary.patternsActivated += 1;
        else if (r.patternEvidenceCount < MIN_PATTERN_EVIDENCE) summary.patternsBuildingEvidence += 1;
      }
    }
  }

  const manuallyPickedModels = new Set(
    pendingCorrections.filter((c) => c.field === 'model').map((c) => `${c.scope}:${c.rawValue}`)
  );
  await Promise.all(
    groups.map((group) => {
      const brand = group.original.make;
      const model = group.original.model;
      if (!brand || !model) return Promise.resolve();
      const wasManualPick = manuallyPickedModels.has(`${brand}:${model}`);
      return recordModelBrandMatch({
        rawModel: model,
        brand,
        crmModelMatch: model,
        source: wasManualPick ? 'manual_pick' : 'auto',
      });
    })
  );

  return summary;
}

/** Snapshot of a batch action, kept so it can be undone in one click. */
interface BulkFillSnapshot {
  field: string;
  /** Each affected group's full prior state, not just the one field — validateRow may have touched other fields too (e.g. a corrected category). */
  previous: Record<string, GroupedModelRow>;
}

interface QcImportState {
  groups: GroupedModelRow[];
  /** Manual Pick corrections since the last Verify & Learn — see useBulkUploadStore's matching field for the full reasoning. */
  pendingCorrections: PendingCorrection[];
  /** Last batch-fill action, if any and if not already undone — powers the Undo button. */
  lastBulkFill: BulkFillSnapshot | null;

  setGroups: (groups: GroupedModelRow[]) => void;
  removeGroup: (id: string) => void;
  clearGroups: () => void;
  updateGroupField: (id: string, field: string, value: string) => Promise<void>;
  addPendingCorrection: (correction: PendingCorrection) => void;
  /**
   * Applies one value to a given field across every currently-selected
   * group in a single action — the batch-default mechanism for fields
   * with no source signal at all (e.g. color) rather than requiring the
   * operator to click through each group one at a time. Snapshots the
   * prior state first so a wrong batch value can be undone in one click
   * instead of needing Clear All.
   */
  bulkFillField: (field: string, value: string, groupIds: string[]) => Promise<void>;
  /** Reverts the most recent bulkFillField call. No-op if there's nothing to undo. */
  undoLastBulkFill: () => void;
  /**
   * Re-runs validateRow on every group's CURRENT `original` (no
   * re-extraction, no re-grouping) — used after reloading general or
   * per-brand CRM data, so newly-added CRM options can resolve
   * previously-unmatched cells without losing any corrections already
   * made in this session.
   */
  revalidateGroups: () => Promise<void>;
  /**
   * Learns from Picked corrections. QC Import never creates CRM records
   * itself — see the module doc comment — so this (plus downloading the
   * sheet) is the actual point of the whole review step, not a
   * secondary action alongside an upload.
   */
  verifyAndLearn: () => Promise<LearningSummary>;
}

// ---------------------------------------------------------------------------
// QC Import is a data-prep tool, not a CRM-writing one: it never calls
// /api/models/submit or /api/models/search. The deliverable is a
// downloaded, cleaned-up sheet that a different person runs through
// Bulk Upload (the ONLY flow that actually creates CRM records) —
// see the "QC team enters raw file -> download processed file -> someone
// else uploads via Bulk Upload" flow this was scoped around. This store
// therefore only ever does two things to the outside world: read-only
// CRM lookups (via validateRow, for matching/suggestions) and writes to
// OUR OWN MongoDB (learning), never a legacy CRM write.
// ---------------------------------------------------------------------------
export const useQcImportStore = create<QcImportState>()(
  persist(
    (set, get) => ({
      groups: [],
      pendingCorrections: [],
      lastBulkFill: null,

      // Deliberately does NOT persist across setGroups — a fresh upload
      // is a genuinely new session, not a continuation.
      setGroups: (groups) => set({ groups, pendingCorrections: [], lastBulkFill: null }),

      removeGroup: (id) => set((state) => ({ groups: state.groups.filter((g) => g.id !== id) })),

      clearGroups: () => set({ groups: [], pendingCorrections: [], lastBulkFill: null }),

      addPendingCorrection: (correction) =>
        set((state) => ({ pendingCorrections: [...state.pendingCorrections, correction] })),

      updateGroupField: async (id, field, value) => {
        const { groups } = get();
        const target = groups.find((g) => g.id === id);
        if (!target) return;

        const newOriginal = { ...target.original, [field]: value };
        set((state) => ({
          groups: state.groups.map((g) => (g.id === id ? { ...g, original: newOriginal } : g)),
        }));

        const result = await validateRow(newOriginal);
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === id
              ? { ...g, original: result.correctedOriginal, data: result.data, errors: result.errors, isValid: result.isValid }
              : g
          ),
        }));
      },

      bulkFillField: async (field, value, groupIds) => {
        const idSet = new Set(groupIds);
        const { groups } = get();

        const targets = groups.filter((g) => idSet.has(g.id));
        // Snapshot BEFORE mutating — full group objects, so undo restores
        // exactly what was there, including any earlier per-row edits.
        const previous: Record<string, GroupedModelRow> = {};
        targets.forEach((g) => {
          previous[g.id] = g;
        });

        const updated = await Promise.all(
          targets.map(async (g) => {
            const newOriginal = { ...g.original, [field]: value };
            const result = await validateRow(newOriginal);
            // Use result.correctedOriginal, not newOriginal — validateRow may
            // have applied its own deterministic corrections (whitespace,
            // etc.) on top of this bulk-fill value.
            return { id: g.id, ...result };
          })
        );
        const updatedById = new Map(updated.map((u) => [u.id, u]));

        set((state) => ({
          groups: state.groups.map((g) => {
            const u = updatedById.get(g.id);
            if (!u) return g;
            return { ...g, original: u.correctedOriginal, data: u.data, errors: u.errors, isValid: u.isValid };
          }),
          lastBulkFill: { field, previous },
        }));
      },

      undoLastBulkFill: () => {
        const { lastBulkFill } = get();
        if (!lastBulkFill) return;

        set((state) => ({
          groups: state.groups.map((g) => lastBulkFill.previous[g.id] ?? g),
          lastBulkFill: null,
        }));
      },

      revalidateGroups: async () => {
        const { groups } = get();
        const results = await Promise.all(groups.map((g) => validateRow(g.original)));
        set((state) => ({
          groups: state.groups.map((g, i) => {
            const r = results[i];
            return { ...g, original: r.correctedOriginal, data: r.data, errors: r.errors, isValid: r.isValid };
          }),
        }));
      },

      verifyAndLearn: async () => {
        const { groups, pendingCorrections } = get();
        if (pendingCorrections.length === 0) return { exactLearned: 0, patternsActivated: 0, patternsBuildingEvidence: 0 };

        // Learn from ALL groups with a fixed model (not just isValid
        // ones) — a group can have a correct model but still need review
        // elsewhere, and that shouldn't block learning the model fix.
        const summary = await flushLearning(groups, pendingCorrections);
        set({ pendingCorrections: [] });

        return summary;
      },
    }),
    {
      name: 'gorevive-qc-import-session',
      storage: createJSONStorage(() => localStorage),
      // Everything in state is meant to survive a reload — there's no
      // transient loading/progress state left now that this store
      // doesn't drive an upload flow.
    }
  )
);