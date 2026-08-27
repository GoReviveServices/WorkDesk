import type { ExtractedField } from './types';

/**
 * Direct-passthrough fields (RAM, HDD, SSD, Display Size) where the QC
 * report's raw text already looks close to backend dropdown vocabulary
 * (e.g. "8 GB", "512 GB", "15.6 inches") — per TRD §5, these are expected
 * to mostly auto-match at the exact-match validation stage in
 * lib/shared/excelTemplate.ts's validateRow, not here. This function's
 * job is just: normalize "NA" and whitespace, nothing more.
 */
export function extractDirectField(raw: string, fieldLabel: string): ExtractedField {
  const trimmed = (raw ?? '').trim();

  if (!trimmed || trimmed.toUpperCase() === 'NA') {
    return { value: '', rawSource: raw, tier: 'missing', rule: `${fieldLabel}-empty-or-na` };
  }

  return { value: trimmed, rawSource: raw, tier: 'matched', rule: `${fieldLabel}-passthrough` };
}
