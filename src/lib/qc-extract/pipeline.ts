import { parseQcFile } from './parseFile';
import { extractRow } from './extractRow';
import { groupRows } from './grouping';
import { validateRow } from '@/lib/shared/excelTemplate';
import { correctCategoryPlacement } from '@/lib/shared/categoryMap';
import type { GroupedModelRow } from './types';
import { preloadValidationData } from '@/lib/shared/excelTemplate';


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
    extractedRows.push(await extractRow(rawRows[index], index + 2));
  }

  onProgress?.('grouping', 0, 1);
  const groups = groupRows(extractedRows);
  await preloadValidationData(groups.map((g) => g.original));
  onProgress?.('validating', 0, groups.length);
  const validatedGroups: GroupedModelRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    onProgress?.('validating', i + 1, groups.length);
    const group = groups[i];
    const correctedOriginal = await correctCategoryPlacement(group.original);

    const result = await validateRow(correctedOriginal);
    const { hsn_code: _hsnError, ...errorsWithoutHsn } = result.errors;
    const isValid = Object.keys(errorsWithoutHsn).length === 0;

    validatedGroups.push({
      ...group,
      original: result.correctedOriginal,
      data: result.data,
      errors: errorsWithoutHsn,
      isValid,
    });
  }

  return validatedGroups;
}