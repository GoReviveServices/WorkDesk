import type { ExtractedField } from './types';

// Ships as data, not hardcoded logic buried in the function — ops can
// extend this as new device sources appear without touching extraction
// code. Validated against every distinct raw Brand string in the sample
// QC report (9 values, 87 rows, 100% resolved).
export const BRAND_ALIASES: Record<string, string> = {
  'ASUSTEK COMPUTER INC.': 'Asus',
  'MICRO-STAR INTERNATIONAL CO., LTD.': 'MSI',
  LENOVO: 'Lenovo',
  HP: 'HP',
  DELL: 'Dell',
  ACER: 'Acer',
  AVITA: 'Avita',
  INFINIX: 'Infinix',
  // Observed: reseller/OEM entity in the raw SMBIOS string, not the
  // retail brand printed on the device — confirmed via the Model field
  // ("Nokia PureBook ...") in every row carrying this brand string.
  'FLIPKART INDIA PVT. LTD.': 'Nokia',
};

const CORPORATE_SUFFIX_RE = /\b(CO\.?,?\s*LTD\.?|INC\.?|PVT\.?\s*LTD\.?|CORPORATION|CORP\.?)\b/g;

export function extractBrand(raw: string): ExtractedField {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, ' ');

  const alias = BRAND_ALIASES[normalized];
  if (alias) {
    return { value: alias, rawSource: raw, tier: 'matched', rule: `brand-alias:${normalized}` };
  }

  const stripped = normalized.replace(CORPORATE_SUFFIX_RE, '').trim();
  if (BRAND_ALIASES[stripped]) {
    return { value: BRAND_ALIASES[stripped], rawSource: raw, tier: 'suggested', rule: 'brand-suffix-strip' };
  }

  // No confident mapping — hand off to the existing fuzzy-suggestion
  // engine downstream (suggestClosest against master.make in
  // lib/shared/excelTemplate.ts's validateRow).
  return { value: raw.trim(), rawSource: raw, tier: 'needs_review', rule: 'brand-unmapped' };
}
