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
import type { ValidatedRow } from '@/lib/shared/validation';

// ---------------------------------------------------------------------------
// Client-side wrappers for our own /api/models/* routes. The server-side
// route handlers already do the legacy HTML parsing (parseLegacyFormResponse,
// parseModelListHtml) — these just call them and return typed JSON.
// ---------------------------------------------------------------------------

async function searchModelsByName(modelName: string): Promise<ModelListRow[]> {
  try {
    const response = await fetch(`/api/models/search?name=${encodeURIComponent(modelName)}`);
    if (!response.ok) {
      console.error(`Failed to search models for "${modelName}":`, response.status);
      return [];
    }
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
 * The "learning" half of an upload — split out so it can run WITHOUT
 * the "submit to CRM" half (see verifyAndLearn). Same helper/reasoning
 * as useQcImportStore's flushLearning.
 */
export interface LearningSummary {
  exactLearned: number;
  patternsActivated: number;
  patternsBuildingEvidence: number;
}

async function flushLearning(rows: ValidatedRow[], pendingCorrections: PendingCorrection[]): Promise<LearningSummary> {
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
    rows.map((row) => {
      const brand = row.original.make;
      const model = row.original.model;
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

// ---------------------------------------------------------------------------

interface AppState {
  rows: ValidatedRow[];
  /** Outcome (incl. generated Model Code) per row, keyed by row.id. */
  results: Record<string, RowResult>;
  /**
   * Manual Pick corrections made since the last upload, held here rather
   * than written to the learned-corrections DB immediately — an
   * exploratory pick that gets changed again before upload shouldn't
   * pollute what the system learns. Flushed (and cleared) at the start
   * of submitValidRows, so only corrections that actually made it into
   * an upload get remembered.
   */
  pendingCorrections: PendingCorrection[];

  isUploading: boolean;
  uploadProgress: {
    current: number;
    total: number;
    success: number;
    failed: number;
  };

  setRows: (rows: ValidatedRow[]) => void;
  removeRow: (id: string) => void;
  clearRows: () => void;
  submitValidRows: () => Promise<void>;
  updateRowField: (id: string, field: string, value: string) => Promise<void>;
  addPendingCorrection: (correction: PendingCorrection) => void;
  /** Learns from Picked corrections WITHOUT submitting anything to the CRM — see useQcImportStore's verifyAndLearn for the full reasoning. */
  verifyAndLearn: () => Promise<LearningSummary>;
}

export const useBulkUploadStore = create<AppState>((set, get) => ({
  rows: [],
  results: {},
  pendingCorrections: [],

  isUploading: false,
  uploadProgress: { current: 0, total: 0, success: 0, failed: 0 },

  setRows: (rows) => set({ rows, results: {}, pendingCorrections: [] }),

  removeRow: (id) =>
    set((state) => ({
      rows: state.rows.filter((row) => row.id !== id),
    })),

  clearRows: () =>
    set({
      rows: [],
      results: {},
      pendingCorrections: [],
      uploadProgress: { current: 0, total: 0, success: 0, failed: 0 },
    }),

  addPendingCorrection: (correction) =>
    set((state) => ({ pendingCorrections: [...state.pendingCorrections, correction] })),

  updateRowField: async (id, field, value) => {
    const { rows } = get();
    const target = rows.find((r) => r.id === id);
    if (!target) return;

    const newOriginal = { ...target.original, [field]: value };

    set((state) => ({
      rows: state.rows.map((r) => (r.id === id ? { ...r, original: newOriginal } : r)),
    }));

    const result = await validateRow(newOriginal);

    set((state) => ({
      rows: state.rows.map((r) =>
        r.id === id
          ? { ...r, original: result.correctedOriginal, data: result.data, errors: result.errors, isValid: result.isValid }
          : r
      ),
    }));
  },

  submitValidRows: async () => {
    const { rows, pendingCorrections } = get();
    const validRows = rows.filter((row) => row.isValid);

    if (validRows.length === 0) return;

    // Persist any manual Pick corrections made while building this
    // batch — deferred until the actual upload rather than written on
    // every Pick click, so an exploratory pick that's later changed
    // doesn't get remembered as if it were confirmed. Deduped by
    // (field, scope, rawValue): if the same fix was picked on multiple
    // rows, only the most recent decision for that combination is sent.
    await flushLearning(validRows, pendingCorrections);
    if (pendingCorrections.length > 0) {
      set({ pendingCorrections: [] });
    }

    set({
      isUploading: true,
      uploadProgress: { current: 0, total: validRows.length, success: 0, failed: 0 },
      results: {},
    });

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];

      set((state) => ({
        uploadProgress: { ...state.uploadProgress, current: i + 1 },
      }));

      try {
        // The model text was already exact-match validated earlier, so
        // it's safe to use as-is for the search query.
        const modelName = row.original.model;

        // 1. Baseline — every Model Code that already exists for this
        //    model name, BEFORE we create this row.
        const before = await searchModelsByName(modelName);
        const beforeCodes = new Set(before.map((r) => r.modelCode));

        // 2. Submit
        const legacy = await submitModel(row.data as Record<string, string>);

        if (!legacy.success) {
          // e.g. "Model Already Available..." — the model already exists,
          // so look it up and surface its REAL code instead of leaving it
          // blank. Only bother searching for duplicate-style failures;
          // other errors (malformed data, server error) have no code to find.
          const isDuplicate = /already/i.test(legacy.message);
          let modelCode: string | null = null;
          let message = legacy.message;

          if (isDuplicate) {
            const existing = await searchModelsByName(modelName);
            const rawBrand = row.original.make.trim().toUpperCase();
            const brandMatched = existing.filter((r) => r.brand.trim().toUpperCase() === rawBrand);
            const candidates = brandMatched.length > 0 ? brandMatched : existing;

            if (candidates.length === 0) {
              message = `${legacy.message} (server says it's a duplicate, but no matching row was found on search — check manually).`;
            } else if (candidates.length === 1) {
              modelCode = candidates[0].modelCode;
              message = `Already exists as ${modelCode}`;
            } else {
              const expectedDesc = buildExpectedModelDescription(row.original);
              const { match, exact } = pickCandidateByDescription(candidates, expectedDesc);

              if (match && exact) {
                modelCode = match.modelCode;
                message = `Already exists as ${modelCode} (matched exactly by full spec description)`;
              } else if (match) {
                modelCode = match.modelCode;
                message = `Already exists — closest spec match is ${modelCode} out of ${candidates.length} candidates (no exact description match). Verify manually.`;
              } else {
                modelCode = candidates.map((c) => c.modelCode).join(', ');
                message = `Already exists — ${candidates.length} matching codes found (${modelCode}). Could not disambiguate by description — verify manually.`;
              }
            }
          }

          set((state) => ({
            results: {
              ...state.results,
              [row.id]: { modelCode, status: 'duplicate', message },
            },
            uploadProgress: { ...state.uploadProgress, failed: state.uploadProgress.failed + 1 },
          }));
          continue;
        }

        // 3. Diff — whatever Model Code appears now but wasn't in the
        //    baseline is the one we just created.
        const after = await searchModelsByName(modelName);
        const newRows = after.filter((r) => !beforeCodes.has(r.modelCode));

        const rawBrand = row.original.make.trim().toUpperCase();
        const brandMatched = newRows.filter((r) => r.brand.trim().toUpperCase() === rawBrand);
        const candidates = brandMatched.length > 0 ? brandMatched : newRows;

        if (candidates.length === 1) {
          set((state) => ({
            results: {
              ...state.results,
              [row.id]: { modelCode: candidates[0].modelCode, status: 'success', message: 'Created' },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        } else if (candidates.length > 1) {
          const expectedDesc = buildExpectedModelDescription(row.original);
          const { match, exact } = pickCandidateByDescription(candidates, expectedDesc);
          const chosen = match ?? candidates.reduce((a, b) => (Number(a.sno) > Number(b.sno) ? a : b));

          set((state) => ({
            results: {
              ...state.results,
              [row.id]: {
                modelCode: chosen.modelCode,
                status: exact ? 'success' : 'ambiguous',
                message: exact
                  ? `Created as ${chosen.modelCode} (confirmed by exact spec match)`
                  : `Created, but ${candidates.length} new matching rows appeared — closest spec match is ${chosen.modelCode}. Verify manually.`,
              },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        } else {
          set((state) => ({
            results: {
              ...state.results,
              [row.id]: {
                modelCode: null,
                status: 'ambiguous',
                message: 'Server confirmed creation, but no new matching row was found on re-search. Check manually.',
              },
            },
            uploadProgress: { ...state.uploadProgress, success: state.uploadProgress.success + 1 },
          }));
        }
      } catch (error) {
        console.error(`Failed to upload row ${row.rowIndex}:`, error);
        set((state) => ({
          results: {
            ...state.results,
            [row.id]: {
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
    const { rows, pendingCorrections } = get();
    if (pendingCorrections.length === 0) return { exactLearned: 0, patternsActivated: 0, patternsBuildingEvidence: 0 };

    const summary = await flushLearning(rows, pendingCorrections);
    set({ pendingCorrections: [] });

    return summary;
  },
}));