import * as XLSX from 'xlsx';
import { bulkModelSchema, type ValidatedRow, type BulkModelPayload, type FieldError } from './validation';
import { findExactMatch, suggestClosest, describeCharDiff, levenshtein, findWhitespaceInsensitiveMatch, findNumericPrecisionMatch, findStorageUnitMatch } from './matching';
import { correctCategoryPlacement } from './categoryMap';
import { applyFieldCorrections } from './fieldCorrections.client';
import { lookupModelBrand } from './modelBrandIndex.client';

// ---------------------------------------------------------------------------
// Client-side fetch wrappers for OUR OWN API routes (never the legacy
// backend directly — see src/app/api/master-data and /field-options).
// These mirror the caching behavior of the original apiUtils.ts
// (cachedMasterData / dynamicMapCache), just one hop further out: our
// server-side routes already cache the legacy-backend responses, and this
// layer caches OUR responses so a single browser session doesn't
// re-request the same brand/category dropdown repeatedly across rows.
// ---------------------------------------------------------------------------

type MasterData = Record<string, Record<string, string>>;

let cachedMasterData: MasterData | null = null;

async function fetchMasterData(): Promise<MasterData> {
  if (cachedMasterData) return cachedMasterData;

  try {
    const response = await fetch('/api/master-data');
    if (!response.ok) {
      console.error('Failed to fetch master data:', response.status);
      cachedMasterData = {};
      return cachedMasterData;
    }
    cachedMasterData = await response.json();
    return cachedMasterData!;
  } catch (error) {
    console.error('Failed to fetch master data:', error);
    cachedMasterData = {};
    return cachedMasterData;
  }
}

/**
 * Clears this browser tab's cached general/global data (CPU list, GPU
 * list, HSN codes, colors, etc. — everything brand-independent) and
 * fetches it fresh, bypassing both this tab's cache and the server-side
 * one. For when something new got added on the CRM side and the operator
 * doesn't want to lose their current in-progress review to pick it up.
 */
export async function resetMasterDataCache(): Promise<void> {
  cachedMasterData = null;
  try {
    const response = await fetch('/api/master-data?refresh=true');
    if (response.ok) {
      cachedMasterData = await response.json();
    }
  } catch (error) {
    console.error('Failed to refresh master data:', error);
  }
}

const dynamicMapCache = new Map<string, Record<string, string>>();

async function fetchDynamicMap(action: string, value: string): Promise<Record<string, string>> {
  const cacheKey = `${action}:${value}`;
  if (dynamicMapCache.has(cacheKey)) {
    return dynamicMapCache.get(cacheKey)!;
  }

  try {
    const params = new URLSearchParams({ action, value });
    const response = await fetch(`/api/field-options?${params.toString()}`);
    if (!response.ok) {
      console.error(`Failed to fetch field options for ${action}=${value}:`, response.status);
      return {};
    }
    const map = await response.json();
    dynamicMapCache.set(cacheKey, map);
    return map;
  } catch (error) {
    console.error(`Failed to fetch field options for ${action}=${value}:`, error);
    return {};
  }
}

/**
 * Clears this browser tab's cached category/model list for ONE brand and
 * fetches it fresh, bypassing both this tab's cache and the server-side
 * one. Scoped to a single brandId so a new model added to one brand on
 * the CRM doesn't require reloading everyone's cached data.
 */
export async function resetBrandCache(brandId: string): Promise<void> {
  const actions = ['getProductName_master', 'getModel_masterlist'];
  await Promise.all(
    actions.map(async (action) => {
      dynamicMapCache.delete(`${action}:${brandId}`);
      try {
        const params = new URLSearchParams({ action, value: brandId, refresh: 'true' });
        const response = await fetch(`/api/field-options?${params.toString()}`);
        if (response.ok) {
          dynamicMapCache.set(`${action}:${brandId}`, await response.json());
        }
      } catch (error) {
        console.error(`Failed to refresh field options for ${action}=${brandId}:`, error);
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Column mapping / field configuration — unchanged from the original.
// ---------------------------------------------------------------------------

export const COLUMN_MAPPING: Record<string, string> = {
  'Brand *': 'make',
  'Category Name *': 'product_name',
  'Sub Category *': 'sub_producd',
  'Model Name *': 'model',
  'HSN Code *': 'hsn_code',
  'RAM Capacity': 'ram_cap',
  HDD: 'strg1',
  SSD: 'strg2',
  'CPU Core': 'cpu_core',
  'CPU Gen': 'cpu_gen',
  'CPU Speed': 'cpu_speed',
  Color: 'color',
  'Graphic Type': 'gpu_type',
  'Graphic Capacity': 'gpu_cap',
  'Display Type': 'display_type',
  'Display Size': 'display_size',
  'Keyboard (Y/N)': 'keyboard',
  'Optical Drive': 'op_drive',
  'Is New (Y/N)': 'model_typenew',
};

const REQUIRED_FIELDS = new Set(['make', 'product_name', 'sub_producd', 'model', 'hsn_code']);

const STATIC_DROPDOWN_FIELDS = [
  'hsn_code',
  'ram_cap',
  'strg1',
  'strg2',
  'cpu_core',
  'cpu_gen',
  'cpu_speed',
  'color',
  'gpu_type',
  'gpu_cap',
  'display_type',
  'display_size',
] as const;

// ---------------------------------------------------------------------------
// Model Description reconstruction — used to disambiguate multiple
// candidate rows after a create/duplicate, via the model-search diff.
// ---------------------------------------------------------------------------

export function buildExpectedModelDescription(original: Record<string, string>): string {
  const parts: string[] = [];
  const push = (v?: string) => {
    if (v) parts.push(v);
  };

  push(original.make);
  push(original.sub_producd);
  push(original.model);
  push(original.cpu_core);
  push(original.cpu_gen);
  push(original.cpu_speed);
  if (original.strg1) parts.push('HDD', original.strg1);
  if (original.ram_cap) parts.push('RAM', original.ram_cap);
  push(original.display_size);
  push(original.gpu_type);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export interface ModelListRow {
  sno: string;
  modelCode: string;
  brand: string;
  product: string;
  model: string;
  modelDesc: string;
  editId: string | null;
  status: string;
}

export function pickCandidateByDescription(
  candidates: ModelListRow[],
  expectedDesc: string
): { match: ModelListRow | null; exact: boolean } {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = normalize(expectedDesc);

  for (const c of candidates) {
    if (normalize(c.modelDesc) === target) {
      return { match: c, exact: true };
    }
  }

  let best: ModelListRow | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = levenshtein(normalize(c.modelDesc), target);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return { match: best, exact: false };
}

// ---------------------------------------------------------------------------
// Template download / results export — unchanged, browser-side XLSX.
// ---------------------------------------------------------------------------

export const downloadTemplate = () => {
  const headers = Object.keys(COLUMN_MAPPING);
  const worksheet = XLSX.utils.aoa_to_sheet([headers]);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk_Upload_Template');
  XLSX.writeFile(workbook, 'GoRevive_Model_Upload_Template.xlsx');
};

export interface RowResult {
  modelCode: string | null;
  status: 'success' | 'duplicate' | 'failed' | 'ambiguous';
  message: string;
}

/**
 * Exports the CURRENT mapped payload (row.data — exactly what
 * submitValidRows would POST to /api/models/submit) for every row,
 * side-by-side with the raw uploaded value, so the operator can inspect
 * the field-mapping result before anything is ever actually submitted.
 * Pure local export — makes no network calls, doesn't touch the store.
 */
export function downloadProcessedData(rows: ValidatedRow[]) {
  const fieldEntries = Object.entries(COLUMN_MAPPING); // [label, backendKey][]

  const headers: string[] = ['Row #', 'Valid'];
  fieldEntries.forEach(([label]) => {
    headers.push(`${label} (raw)`, `${label} (mapped)`);
  });
  headers.push('CPU Series (sheet only)', 'Validation Errors');

  const data = rows.map((row) => {
    const line: Record<string, string> = {
      'Row #': String(row.rowIndex),
      Valid: row.isValid ? 'Yes' : 'No',
    };

    fieldEntries.forEach(([label, key]) => {
      line[`${label} (raw)`] = row.original[key] || '';
      line[`${label} (mapped)`] = (row.data as Record<string, string> | undefined)?.[key] || '';
    });

    // Only QC-import rows carry this (bulk-upload rows leave it blank).
    line['CPU Series (sheet only)'] = 'cpuSeries' in row ? (row as { cpuSeries: string }).cpuSeries : '';
    line['Validation Errors'] = Object.values(row.errors)
      .map((e) => e.message)
      .join(' | ');

    return line;
  });

  const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Processed_Data');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `GoRevive_Processed_Data_${dateStamp}.xlsx`);
}

export function downloadResults(rows: ValidatedRow[], results: Record<string, RowResult>) {
  const fieldHeaders = Object.keys(COLUMN_MAPPING);
  const headers = [...fieldHeaders, 'CPU Series (sheet only)', 'Model Code', 'Upload Status', 'Message'];

  const data = rows.map((row) => {
    const result = results[row.id];
    const line: Record<string, string> = {};

    Object.entries(COLUMN_MAPPING).forEach(([label, key]) => {
      line[label] = row.original[key] || '';
    });

    line['CPU Series (sheet only)'] = 'cpuSeries' in row ? (row as { cpuSeries: string }).cpuSeries : '';
    line['Model Code'] = result?.modelCode || '';
    line['Upload Status'] = result ? result.status : row.isValid ? 'Not uploaded' : 'Validation failed';
    line['Message'] = result?.message || Object.values(row.errors).map((e) => e.message).join(' | ');

    return line;
  });

  const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Upload_Results');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `GoRevive_Upload_Results_${dateStamp}.xlsx`);
}

// ---------------------------------------------------------------------------
// Field error construction — unchanged.
// ---------------------------------------------------------------------------

function buildFieldError(fieldLabel: string, rawValue: string, map: Record<string, string>): FieldError {
  if (!rawValue) {
    return { message: `${fieldLabel} is required.` };
  }

  const suggestion = suggestClosest(map, rawValue);
  if (!suggestion) {
    return { message: `"${rawValue}" was not found in the system's ${fieldLabel} list.` };
  }

  const diff = describeCharDiff(rawValue, suggestion);

  const message = diff
    ? `"${rawValue}" does not exactly match "${suggestion}". ${diff}`
    : `"${rawValue}" does not exactly match "${suggestion}" — check for extra/missing spaces or different capitalization.`;

  return { message, suggestion };
}

async function resolveBrandId(original: Record<string, string>): Promise<string | null> {
  const master = await fetchMasterData();
  return findExactMatch(master.make || {}, original.make || '');
}

async function resolveCategoryId(original: Record<string, string>, brandId: string): Promise<string | null> {
  const categoryMap = await fetchDynamicMap('getProductName_master', brandId);
  return findExactMatch(categoryMap, original.product_name || '');
}

/**
 * Resolves a raw value against a dropdown map: exact match first, then
 * whitespace-insensitive, then numeric-precision-insensitive (e.g.
 * "1.2GHz" vs "1.20GHz") before giving up. Returns both the resolved ID
 * (for internal data mapping) and the corrected raw text (for updating
 * what's actually displayed) — these are DIFFERENT things and both need
 * to flow back to the caller; see the note on `correctedOriginal` in
 * validateRow below.
 */
function resolveAgainstMap(
  map: Record<string, string>,
  rawValue: string
): { id: string | null; correctedRaw: string } {
  const directId = findExactMatch(map, rawValue);
  if (directId) return { id: directId, correctedRaw: rawValue };

  const wsMatch = findWhitespaceInsensitiveMatch(map, rawValue);
  if (wsMatch) {
    return { id: findExactMatch(map, wsMatch), correctedRaw: wsMatch };
  }

  const numMatch = findNumericPrecisionMatch(map, rawValue);
  if (numMatch) {
    return { id: findExactMatch(map, numMatch), correctedRaw: numMatch };
  }

  const storageMatch = findStorageUnitMatch(map, rawValue);
  if (storageMatch) {
    return { id: findExactMatch(map, storageMatch), correctedRaw: storageMatch };
  }

  return { id: null, correctedRaw: rawValue };
}

// ---------------------------------------------------------------------------
// Row validation — same cascade logic as the original (brand -> category ->
// model -> sub-category, plus static dropdown fields), now sourced from
// our own /api routes instead of apiUtils.ts's direct legacy calls.
// ---------------------------------------------------------------------------

export async function validateRow(rawOriginal: Record<string, string>): Promise<{
  data: Record<string, string>;
  errors: Record<string, FieldError>;
  isValid: boolean;
  /**
   * A copy of rawOriginal with any deterministic whitespace-only fixes
   * applied (e.g. "8 GB" -> "8GB" once we know that's the real dropdown
   * text). Callers should store THIS as the row's `original`, not the
   * value they passed in — otherwise the correction only affects
   * internal validation while the table keeps displaying the
   * uncorrected text, which is confusing (this bit us once already with
   * the Category/Sub Category swap fix — same lesson applies here).
   */
  correctedOriginal: Record<string, string>;
}> {
  const master = await fetchMasterData();
  const mappedData: Record<string, string> = { ...rawOriginal };
  const correctedOriginal: Record<string, string> = { ...rawOriginal };
  const errors: Record<string, FieldError> = {};

  // --- Brand (model-first: a model can only ever belong to one brand,
  // so once we've CRM-confirmed a model->brand pairing once, it's a
  // more reliable signal than a raw manufacturer string — which can be
  // a generic reseller/OEM placeholder shared across many real brands.
  // See lib/server/modelBrandIndex.ts for the "Flipkart manufacturer
  // string -> actually Nokia" case this specifically targets.) ---
  const modelBrandHint = await lookupModelBrand(mappedData.model);

  const rawBrand = mappedData.make;
  // Same learning layer Model already gets — a Picked fix for e.g.
  // "Panache DigiLife Limited" or "Nexstgo Technologies India Pvt Ltd"
  // is remembered (scope 'global', since brand names aren't per-brand
  // scoped) and auto-applied before matching, same 3-layer flow
  // (automatic -> pick -> learn) as every other field.
  const learnedBrand = await applyFieldCorrections('make', 'global', rawBrand);
  const brandResolved = resolveAgainstMap(master.make || {}, learnedBrand);
  const rawBrandId = brandResolved.id;

  let brandId: string | null = null;
  let brandDisplayText = rawBrand;

  if (modelBrandHint) {
    // The index's brand is NEVER trusted on its own — it only wins if
    // it ALSO resolves against the live master.make list right now,
    // same rule as every other value in this function.
    const hintBrandId = findExactMatch(master.make || {}, modelBrandHint.brand);
    if (hintBrandId) {
      if (rawBrandId && rawBrandId !== hintBrandId) {
        // Genuine disagreement between two CRM-verifiable signals —
        // never silently pick a winner, surface it for a human instead.
        errors.make = {
          message: `Conflicting brand signals: raw Brand resolves to "${brandResolved.correctedRaw}", but this exact Model was previously confirmed under "${modelBrandHint.brand}". Verify manually.`,
        };
      } else {
        brandId = hintBrandId;
        brandDisplayText = modelBrandHint.brand;
      }
    }
  }

  if (!brandId && !errors.make) {
    if (rawBrandId) {
      brandId = rawBrandId;
      brandDisplayText = brandResolved.correctedRaw;
    } else {
      errors.make = buildFieldError('Brand', learnedBrand, master.make || {});
    }
  }

  if (brandId) {
    mappedData.make = brandId;
    correctedOriginal.make = brandDisplayText;
  }

  // --- Category (depends on brand) ---
  let categoryId: string | null = null;
  if (brandId) {
    const categoryMap = await fetchDynamicMap('getProductName_master', brandId);
    const rawCategory = mappedData.product_name;
    const categoryResolved = resolveAgainstMap(categoryMap, rawCategory);
    categoryId = categoryResolved.id;
    if (categoryId) {
      mappedData.product_name = categoryId;
      correctedOriginal.product_name = categoryResolved.correctedRaw;
    } else {
      errors.product_name = buildFieldError('Category', rawCategory, categoryMap);
    }
  } else if (mappedData.product_name) {
    errors.product_name = {
      message: 'Cannot verify Category — Brand did not match, so the Category list is unknown.',
    };
  } else {
    errors.product_name = { message: 'Category Name is required.' };
  }

  // --- Model (depends on brand) ---
  if (brandId) {
    const modelMap = await fetchDynamicMap('getModel_masterlist', brandId);
    const rawModel = mappedData.model;
    // Apply any previously-learned corrections for this brand FIRST (see
    // lib/shared/fieldCorrections.client.ts) — e.g. a verified noise
    // prefix like "103C_5335KV HP Notebook HP Laptop " gets stripped
    // automatically before the normal exact/whitespace match even runs.
    const brandName = correctedOriginal.make; // still human-readable text at this point
    const learnedModel = await applyFieldCorrections('model', brandName, rawModel);
    const modelResolved = resolveAgainstMap(modelMap, learnedModel);
    if (modelResolved.id) {
      mappedData.model = modelResolved.id;
      correctedOriginal.model = modelResolved.correctedRaw;
    } else {
      errors.model = buildFieldError('Model', rawModel, modelMap);
    }
  } else if (mappedData.model) {
    errors.model = { message: 'Cannot verify Model — Brand did not match, so the Model list is unknown.' };
  } else {
    errors.model = { message: 'Model Name is required.' };
  }

  // --- Sub Category (depends on category) ---
  if (categoryId) {
    const subMap = await fetchDynamicMap('getsubProductName_master', categoryId);
    const rawSub = mappedData.sub_producd;
    const subResolved = resolveAgainstMap(subMap, rawSub);
    if (subResolved.id) {
      mappedData.sub_producd = subResolved.id;
      correctedOriginal.sub_producd = subResolved.correctedRaw;
    } else {
      errors.sub_producd = buildFieldError('Sub Category', rawSub, subMap);
    }
  } else if (mappedData.sub_producd) {
    errors.sub_producd = {
      message: 'Cannot verify Sub Category — Category did not match, so the Sub Category list is unknown.',
    };
  } else {
    errors.sub_producd = { message: 'Sub Category is required.' };
  }

  // --- Static dropdown fields ---
  for (const field of STATIC_DROPDOWN_FIELDS) {
    const rawValue = mappedData[field];
    if (!rawValue) {
      if (REQUIRED_FIELDS.has(field)) {
        errors[field] = { message: `${field} is required.` };
      }
      continue;
    }
    const fieldMap = master[field] || {};
    // These fields don't vary by brand (one shared master list), so
    // learned corrections are scoped globally rather than per-brand —
    // e.g. a verified fix for "Intel Core i5-9300H" applies to every
    // future row with that exact cpu_core text, regardless of brand.
    const learnedValue = await applyFieldCorrections(field, 'global', rawValue);
    const resolved = resolveAgainstMap(fieldMap, learnedValue);
    if (resolved.id) {
      mappedData[field] = resolved.id;
      correctedOriginal[field] = resolved.correctedRaw;
    } else {
      errors[field] = buildFieldError(field, rawValue, fieldMap);
    }
  }

  // --- Keyboard ---
  if (mappedData.keyboard) {
    const keyboardMap = master.keyboard || {};
    const resolved = resolveAgainstMap(keyboardMap, mappedData.keyboard);
    if (resolved.id) {
      mappedData.keyboard = resolved.id;
      correctedOriginal.keyboard = resolved.correctedRaw;
    } else {
      errors.keyboard = buildFieldError('Keyboard', mappedData.keyboard, keyboardMap);
    }
  }

  // --- Is New ---
  if (mappedData.model_typenew) {
    const isNewMap = master.model_typenew || {};
    const resolved = resolveAgainstMap(isNewMap, mappedData.model_typenew);
    if (resolved.id) {
      mappedData.model_typenew = resolved.id;
      correctedOriginal.model_typenew = resolved.correctedRaw;
    } else {
      errors.model_typenew = buildFieldError('Is New', mappedData.model_typenew, isNewMap);
    }
  }

  // --- Structural validation on top (types, required-ness, etc.) ---
  const validationResult = bulkModelSchema.safeParse(mappedData);
  if (!validationResult.success) {
    validationResult.error.issues.forEach((issue) => {
      const key = String(issue.path[0]);
      if (!errors[key]) {
        errors[key] = { message: issue.message };
      }
    });
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    data: isValid ? (validationResult.data as BulkModelPayload) : mappedData,
    errors,
    isValid,
    correctedOriginal,
  };
}

// ---------------------------------------------------------------------------
// Inline "pick from list" options — unchanged logic.
// ---------------------------------------------------------------------------

export async function getFieldOptions(fieldKey: string, original: Record<string, string>): Promise<string[]> {
  const master = await fetchMasterData();

  if (
    fieldKey === 'make' ||
    fieldKey === 'keyboard' ||
    fieldKey === 'model_typenew' ||
    (STATIC_DROPDOWN_FIELDS as readonly string[]).includes(fieldKey)
  ) {
    return Object.keys(master[fieldKey] || {});
  }

  if (fieldKey === 'product_name') {
    const brandId = await resolveBrandId(original);
    if (!brandId) return [];
    const categories = await fetchDynamicMap('getProductName_master', brandId);
    return Object.keys(categories);
  }

  if (fieldKey === 'model') {
    const brandId = await resolveBrandId(original);
    if (!brandId) return [];
    const models = await fetchDynamicMap('getModel_masterlist', brandId);
    return Object.keys(models);
  }

  if (fieldKey === 'sub_producd') {
    const brandId = await resolveBrandId(original);
    if (!brandId) return [];
    const categoryId = await resolveCategoryId(original, brandId);
    if (!categoryId) return [];
    const subs = await fetchDynamicMap('getsubProductName_master', categoryId);
    return Object.keys(subs);
  }

  return []; // free-text fields (op_drive) have no fixed list
}

// ---------------------------------------------------------------------------
// Excel parsing — unchanged (xlsx/xls only; the QC-import flow handles
// .csv separately in lib/qc-extract).
// ---------------------------------------------------------------------------

export const parseAndValidateExcel = async (
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<ValidatedRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawJson: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, {
          defval: '',
          raw: true,
        });

        const total = rawJson.length;
        const validatedRows: ValidatedRow[] = [];

        for (let index = 0; index < rawJson.length; index++) {
          const row = rawJson[index];
          onProgress?.(index + 1, total);

          let original: Record<string, string> = {};
          Object.keys(COLUMN_MAPPING).forEach((excelHeader) => {
            const apiKey = COLUMN_MAPPING[excelHeader];
            const cell = row[excelHeader];
            original[apiKey] = cell !== undefined && cell !== null ? String(cell) : '';
          });

          // Correct a Category/Sub Category placement mistake (e.g.
          // "Laptop" typed into Category) BEFORE validation, so the
          // table displays the corrected field, not just an internally
          // resolved value sitting behind a still-wrong-looking cell.
          original = await correctCategoryPlacement(original);

          const result = await validateRow(original);

          validatedRows.push({
            id: crypto.randomUUID(),
            rowIndex: index + 2,
            data: result.data,
            // validateRow also silently fixes whitespace-only mismatches
            // (e.g. "8 GB" -> "8GB") — correctedOriginal carries those
            // through, same reasoning as correctCategoryPlacement above.
            original: result.correctedOriginal,
            isValid: result.isValid,
            errors: result.errors,
          });
        }

        resolve(validatedRows);
      } catch (error) {
        reject(error);
      }
    };

    reader.readAsArrayBuffer(file);
  });
};