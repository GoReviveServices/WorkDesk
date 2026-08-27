import type { ValidatedRow } from '@/lib/shared/validation';

export type ConfidenceTier = 'matched' | 'suggested' | 'needs_review' | 'missing';

export interface ExtractedField {
  /** Normalized value we'll attempt to validate/submit. */
  value: string;
  /** Original cell text, always retained for audit + operator context. */
  rawSource: string;
  tier: ConfidenceTier;
  /** Which extraction rule fired, e.g. "brand-alias:asustek", "cpu-intel-at". */
  rule: string;
}

export interface ExtractedRow {
  id: string;
  sourceRowIndex: number;
  serialNo: string;
  fields: {
    make: ExtractedField;
    model: ExtractedField;
    product_name: ExtractedField;
    sub_producd: ExtractedField;
    cpu_core: ExtractedField;
    cpu_gen: ExtractedField;
    cpu_speed: ExtractedField;
    gpu_type: ExtractedField;
    gpu_cap: ExtractedField;
    ram_cap: ExtractedField;
    strg1: ExtractedField; // HDD
    strg2: ExtractedField; // SSD
    display_size: ExtractedField;
    hsn_code: ExtractedField; // always 'missing' until a batch default is applied
    color: ExtractedField; // always 'missing' unless a batch default is applied
  };
  /** Not sent to the backend — audit/grouping context only. */
  qcMeta: {
    grade: string;
    remarks: string;
    engineerComment: string;
    cpuSeries: string;
  };
}

export interface GroupedModelRow extends ValidatedRow {
  groupKey: string;
  unitCount: number;
  serialNumbers: string[];
  sourceRowIndexes: number[];
  fieldTiers: Record<string, ConfidenceTier>;
  cpuSeries: string;
}

/** Raw row shape straight out of the QC report's 42 columns, keyed by header text. */
export type RawQcRow = Record<string, string>;

export const QC_REQUIRED_HEADERS = [
  'Serial No',
  'Item Type',
  'Brand',
  'Model',
  'CPU',
  'RAM',
  'SSD',
  'HDD',
  'GPU-Memory',
  'Screen Size',
  'Grade',
  'QC Remarks',
  "QC Engineer Comment's",
] as const;