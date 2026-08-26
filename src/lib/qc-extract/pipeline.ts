import { parseQcFile } from './parseFile';
import { extractRow } from './extractRow';
import { groupRows } from './grouping';
import { validateRow } from '@/lib/shared/excelTemplate';
import { correctCategoryPlacement } from '@/lib/shared/categoryMap';
import type { GroupedModelRow } from './types';

/**
 * Full QC-report ingestion pipeline (TRD §4):
 *   1. parseQcFile   — .xlsx/.csv -> RawQcRow[]
 *   2. extractRow    — per-row field extraction/normalization
 *   3. groupRows     — collapse identical-spec physical units
 *   4. correctCategoryPlacement — fix a Category/Sub Category swap (the
 *      QC report's "Item Type" always lands in Category via extractRow,
 *      with Sub Category empty — exactly the shape this correction
 *      targets, so it applies to every group here, not just occasionally)
 *   5. validateRow   — EXISTING bulk-upload validation engine, unchanged,
 *                       now receiving normalized+corrected input from
 *                       steps 2-4 instead of directly from a clean
 *                       template sheet.
 *
 * Step 5 is the load-bearing design decision from the TRD: grouping and
 * extraction happen entirely BEFORE validateRow ever sees the data, so
 * the exact-match + fuzzy-suggestion engine, FieldCell's inline-fix UI,
 * and the submit/search flow don't need to know QC rows exist at all.
 */
export async function processQcFile(
  file: File,
  onProgress?: (stage: string, current: number, total: number) => void
): Promise<GroupedModelRow[]> {
  onProgress?.('parsing', 0, 1);
  const rawRows = await parseQcFile(file);

  onProgress?.('extracting', 0, rawRows.length);
  const extractedRows = [];
  for (let index = 0; index < rawRows.length; index++) {
    onProgress?.('extracting', index + 1, rawRows.length);
    extractedRows.push(await extractRow(rawRows[index], index + 2)); // +2: header row + 1-based indexing, matches the clean-template convention
  }

  onProgress?.('grouping', 0, 1);
  const groups = groupRows(extractedRows);

  onProgress?.('validating', 0, groups.length);
  const validatedGroups: GroupedModelRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    onProgress?.('validating', i + 1, groups.length);
    const group = groups[i];

    // Correct BEFORE validating, and keep the corrected value as the
    // group's displayed `original` — not just an internal validation
    // input — so the review table shows "IT Assets" / "Laptop" in the
    // right cells instead of silently resolving it while still
    // displaying "Laptop" under Category.
    const correctedOriginal = await correctCategoryPlacement(group.original);

    const result = await validateRow(correctedOriginal);
    validatedGroups.push({
      ...group,
      // validateRow may ALSO silently fix whitespace-only mismatches
      // (e.g. "8 GB" -> "8GB") on top of the category-placement fix —
      // its own correctedOriginal is the final word on what's displayed.
      original: result.correctedOriginal,
      data: result.data,
      errors: result.errors,
      isValid: result.isValid,
    });
  }

  return validatedGroups;
}