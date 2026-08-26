import type { ExtractedRow, GroupedModelRow } from './types';

const UNIT_SEPARATOR = '\u241F'; // avoids collisions with values containing '|' etc.

/**
 * Grouping key = normalized (make, model, cpu_core, cpu_gen, cpu_speed,
 * ram_cap, strg1, strg2, gpu_type, display_size) — per TRD §6. Grade,
 * remarks, and other per-unit condition fields are deliberately NOT part
 * of the key: Model Master describes the SKU, not the condition of an
 * individual unit. [OQ-3, TRD]: if that assumption turns out to be
 * wrong (grade needs its own listing), this is the one function to
 * change — extraction and validation logic don't need to know about it.
 */
export function computeGroupKey(row: ExtractedRow): string {
  const signature = [
    row.fields.make.value,
    row.fields.model.value,
    row.fields.cpu_core.value,
    row.fields.cpu_gen.value,
    row.fields.cpu_speed.value,
    row.fields.ram_cap.value,
    row.fields.strg1.value,
    row.fields.strg2.value,
    row.fields.gpu_type.value,
    row.fields.display_size.value,
  ].map((v) => v.trim().toLowerCase());

  return signature.join(UNIT_SEPARATOR);
}

const FIELD_KEYS = [
  'make',
  'model',
  'product_name',
  'sub_producd',
  'cpu_core',
  'cpu_gen',
  'cpu_speed',
  'gpu_type',
  'gpu_cap',
  'ram_cap',
  'strg1',
  'strg2',
  'display_size',
  'hsn_code',
  'color',
] as const;

/**
 * Groups extracted rows by spec signature into GroupedModelRow[] — the
 * shape the existing validateRow()/FieldCell/submit pipeline already
 * knows how to handle (GroupedModelRow extends ValidatedRow), so nothing
 * downstream of this needs to know QC rows were ever grouped at all.
 */
export function groupRows(rows: ExtractedRow[]): GroupedModelRow[] {
  const groups = new Map<string, ExtractedRow[]>();

  for (const row of rows) {
    const key = computeGroupKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return Array.from(groups.entries()).map(([groupKey, members]) => {
    const representative = members[0];

    const original: Record<string, string> = {};
    const fieldTiers: Record<string, GroupedModelRow['fieldTiers'][string]> = {};
    FIELD_KEYS.forEach((key) => {
      original[key] = representative.fields[key].value;
      fieldTiers[key] = representative.fields[key].tier;
    });

    return {
      id: crypto.randomUUID(),
      rowIndex: representative.sourceRowIndex,
      groupKey,
      unitCount: members.length,
      serialNumbers: members.map((m) => m.serialNo),
      sourceRowIndexes: members.map((m) => m.sourceRowIndex),
      original,
      fieldTiers,
      cpuSeries: representative.qcMeta.cpuSeries,
      data: {},
      errors: {},
      isValid: false,
    };
  });
}