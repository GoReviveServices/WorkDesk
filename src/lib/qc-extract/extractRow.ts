import type { ExtractedRow, RawQcRow } from './types';
import { extractBrand } from './brand';
import { extractModel } from './model';
import { extractCpu } from './cpu';
import { extractGpu } from './gpu';
import { extractDirectField } from './storage';

function missingField(rawSource: string, rule: string) {
  return { value: '', rawSource, tier: 'missing' as const, rule };
}

export async function extractRow(raw: RawQcRow, sourceRowIndex: number): Promise<ExtractedRow> {
  const cpu = extractCpu(raw.CPU ?? '');
  const gpu = await extractGpu(raw['GPU-Memory'] ?? '');

  return {
    id: crypto.randomUUID(),
    sourceRowIndex,
    serialNo: (raw['Serial No'] ?? '').trim(),
    fields: {
      make: extractBrand(raw.Brand ?? ''),
      model: extractModel(raw.Model ?? ''),

      // No source column for Category/Sub Category — Item Type ("Laptop")
      // is passed through as a best-guess candidate for Category, marked
      // needs_review since it's unverified against the actual legacy
      // dropdown until validateRow resolves it against the brand-specific
      // category list. Sub Category has no signal at all.
      product_name: {
        value: (raw['Item Type'] ?? '').trim(),
        rawSource: raw['Item Type'] ?? '',
        tier: 'needs_review',
        rule: 'product-name-from-item-type',
      },
      sub_producd: missingField(raw['Item Type'] ?? '', 'sub-category-no-source'),

      cpu_core: cpu.core,
      cpu_gen: cpu.gen,
      cpu_speed: cpu.speed,

      gpu_type: gpu.type,
      gpu_cap: gpu.cap,

      ram_cap: extractDirectField(raw.RAM ?? '', 'ram'),
      strg1: extractDirectField(raw.HDD ?? '', 'hdd'),
      strg2: extractDirectField(raw.SSD ?? '', 'ssd'),
      display_size: extractDirectField(raw['Screen Size'] ?? '', 'display-size'),

      // No source column at all — batch-default targets (TRD §5/§6),
      // never guessed.
      hsn_code: missingField('', 'hsn-no-source'),
      color: missingField('', 'color-no-source'),
    },
    qcMeta: {
      grade: (raw.Grade ?? '').trim(),
      remarks: (raw['QC Remarks'] ?? '').trim(),
      engineerComment: (raw["QC Engineer Comment's"] ?? '').trim(),
      cpuSeries: cpu.series,
    },
  };
}