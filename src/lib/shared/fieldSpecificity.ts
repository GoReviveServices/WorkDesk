const AMBIGUOUS_FIELD_KEYS = new Set(['gpu_type', 'cpu_core']);

const GENERIC_VENDOR_ONLY_RE = /^(NVIDIA|Intel|AMD|Advanced Micro Devices|Qualcomm|ATI|Realtek)(\s+Corporation)?\.?$/i;

const UNIDENTIFIED_DEVICE_RE = /\bDevice\s+[0-9a-f]{2,6}\b/i;


export function isSafeToLearnExactMatch(field: string, rawValue: string): boolean {
  if (!AMBIGUOUS_FIELD_KEYS.has(field)) return true;

  const trimmed = rawValue.trim();
  if (!trimmed) return false;
  if (GENERIC_VENDOR_ONLY_RE.test(trimmed)) return false;
  if (UNIDENTIFIED_DEVICE_RE.test(trimmed)) return false;
  if (!/\d/.test(trimmed)) return false;

  return true;
}