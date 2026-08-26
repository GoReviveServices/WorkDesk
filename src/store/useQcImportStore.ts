import { create } from 'zustand';
import {
  validateRow,
  buildExpectedModelDescription,
  pickCandidateByDescription,
  type RowResult,
  type ModelListRow,
} from '@/lib/shared/excelTemplate';
import { recordFieldVerification, type PendingCorrection } from '@/lib/shared/fieldCorrections.client';
import { MIN_PATTERN_EVIDENCE } from '@/lib/shared/learningConfig';
import { recordModelBrandMatch } from '@/lib/shared/modelBrandIndex.client';
import type { GroupedModelRow } from '@/lib/qc-extract/types';

async function searchModelsByName(modelName: string): Promise<ModelListRow[]> {
  try {
    const response = await fetch(`/api/models/search?name=${encodeURIComponent(modelName)}`);
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error(`Failed to search models for "${modelName}":`, error);
    return [];
  }
}

async function submitModel(payload: Record<string, string>): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch('/api/models/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error('Model submission failed:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * The "learning" half of an upload — flushes pendingCorrections and
 * confirms (model -> brand) pairs — split out so it can run WITHOUT the
 * "submit to CRM" half. Safe to call on its own: Pick's options always
 * come from the live CRM dropdown, so a Picked value is already proven
 * correct against real data regardless of whether a row's full
 * submission ever happens.
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

interface QcImportState {
  groups: GroupedModelRow[];
  /** Outcome per group, keyed by group.id — same shape as bulk-upload's results. */
  results: Record<string, RowResult>;
  /** Manual Pick corrections since the last upload — see useBulkUploadStore's matching field for the full reasoning. */
  pendingCorrections: PendingCorrection[];

  isUploading: boolean;
  uploadProgress: { current: number; total: number; success: number; failed: number };

  setGroups: (groups: GroupedModelRow[]) => void;
  removeGroup: (id: string) => void;
  clearGroups: () => void;
  updateGroupField: (id: string, field: string, value: string) => Promise<void>;
  addPendingCorrection: (correction: PendingCorrection) => void;
  /**
   * Applies one value to a given field across every currently-selected
   * group in a single action — the batch-default mechanism from TRD §6
   * for fields with no source signal at all (hsn_code, color) rather
   * than requiring the operator to click through each group one at a time.
   */
  bulkFillField: (field: string, value: string, groupIds: string[]) => Promise<void>;
  submitValidGroups: () => Promise<void>;
  /**
   * Learns from Picked corrections WITHOUT submitting anything to the
   * CRM — a safe way to build up/verify the learned-corrections
   * database using rows that aren't ready (or aren't meant) to be
   * created as real Model Master records yet.
   */
  verifyAndLearn: () => Promise<LearningSummary>;
}

export const useQcImportStore = create<QcImportState>((set, get) => ({
  groups: [],
  results: {},
  pendingCorrections: [],

  isUploading: false,
  uploadProgress: { current: 0, total: 0, success: 0, failed: 0 },

  setGroups: (groups) => set({ groups, results: {}, pendingCorrections: [] }),

  removeGroup: (id) => set((state) => ({ groups: state.groups.filter((g) => g.id !== id) })),

  clearGroups: () =>
    set({
      groups: [],
      results: {},
      pendingCorrections: [],
      uploadProgress: { current: 0, total: 0, success: 0, failed: 0 },
    }),

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
    }));
  },

  submitValidGroups: async () => {
    const { groups, pendingCorrections } = get();
    const validGroups = groups.filter((g) => g.isValid);
    if (validGroups.length === 0) return;

    await flushLearning(validGroups, pendingCorrections);
    if (pendingCorrections.length > 0) {
      set({ pendingCorrections: [] });
    }

    set({
      isUploading: true,
      uploadProgress: { current: 0, total: validGroups.length, success: 0, failed: 0 },
      results: {},
    });

    for (let i = 0; i < validGroups.length; i++) {
      const group = validGroups[i];
      set((state) => ({ uploadProgress: { ...state.uploadProgress, current: i + 1 } }));

      try {
        const modelName = group.original.model;
        const before = await searchModelsByName(modelName);
        const beforeCodes = new Set(before.map((r) => r.modelCode));

        const legacy = await submitModel(group.data as Record<string, string>);

        if (!legacy.success) {
          const isDuplicate = /already/i.test(legacy.message);
          let modelCode: string | null = null;
          let message = legacy.message;

          if (isDuplicate) {
            const existing = await searchModelsByName(modelName);
            const rawBrand = group.original.make.trim().toUpperCase();
            const brandMatched = existing.filter((r) => r.brand.trim().toUpperCase() === rawBrand);
            const candidates = brandMatched.length > 0 ? brandMatched : existing;

            if (candidates.length === 1) {
              modelCode = candidates[0].modelCode;
              message = `Already exists as ${modelCode} (${group.unitCount} units in this batch)`;
            } else if (candidates.length > 1) {
              const expectedDesc = buildExpectedModelDescription(group.original);
              const { match, exact } = pickCandidateByDescription(candidates, expectedDesc);
              if (match) {
                modelCode = match.modelCode;
                message = exact
                  ? `Already exists as ${modelCode} (exact spec match, ${group.unitCount} units)`
                  : `Already exists — closest match ${modelCode} out of ${candidates.length}. Verify manually.`;
              }
            } else {
              message = `${legacy.message} (no matching row found on search — check manually).`;
            }
          }

          set((state) => ({
            results: { ...state.results, [group.id]: { modelCode, status: 'duplicate', message } },
            uploadProgress: { ...state.uploadProgress, failed: state.uploadProgress.failed + 1 },
          }));
          continue;
        }

        const after = await searchModelsByName(modelName);
        const newRows = after.filter((r) => !beforeCodes.has(r.modelCode));
        const rawBrand = group.original.make.trim().toUpperCase();
        const brandMatched = newRows.filter((r) => r.brand.trim().toUpperCase() === rawBrand);
        const candidates = brandMatched.length > 0 ? brandMatched : newRows;

        if (candidates.length === 1) {
          set((state) => ({
            results: {
              ...state.results,
              [group.id]: {
                modelCode: candidates[0].modelCode,
                status: 'success',
                message: `Created (${group.unitCount} units in this batch)`,
              },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        } else if (candidates.length > 1) {
          const expectedDesc = buildExpectedModelDescription(group.original);
          const { match, exact } = pickCandidateByDescription(candidates, expectedDesc);
          const chosen = match ?? candidates.reduce((a, b) => (Number(a.sno) > Number(b.sno) ? a : b));

          set((state) => ({
            results: {
              ...state.results,
              [group.id]: {
                modelCode: chosen.modelCode,
                status: exact ? 'success' : 'ambiguous',
                message: exact
                  ? `Created as ${chosen.modelCode} (confirmed exact match, ${group.unitCount} units)`
                  : `Created, but ${candidates.length} new rows appeared — closest match ${chosen.modelCode}. Verify manually.`,
              },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        } else {
          set((state) => ({
            results: {
              ...state.results,
              [group.id]: {
                modelCode: null,
                status: 'ambiguous',
                message: 'Server confirmed creation, but no new matching row was found. Check manually.',
              },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        }
      } catch (error) {
        console.error(`Failed to upload group (row ${group.rowIndex}):`, error);
        set((state) => ({
          results: {
            ...state.results,
            [group.id]: {
              modelCode: null,
              status: 'failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          },
          uploadProgress: { ...state.uploadProgress, failed: state.uploadProgress.failed + 1 },
        }));
      }
    }

    set({ isUploading: false });
  },

  verifyAndLearn: async () => {
    const { groups, pendingCorrections } = get();
    if (pendingCorrections.length === 0) return { exactLearned: 0, patternsActivated: 0, patternsBuildingEvidence: 0 };

    // Learn from ALL groups with a fixed model (not just isValid ones) —
    // a group can have a correct model but still be missing hsn_code,
    // for instance, and that shouldn't block learning the model fix.
    const summary = await flushLearning(groups, pendingCorrections);
    set({ pendingCorrections: [] });

    return summary;
  },
}));