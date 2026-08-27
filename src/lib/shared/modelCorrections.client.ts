export interface ModelCorrectionEntry {
  type: 'exact' | 'strip_prefix' | 'dedupe_repeat';
  rawKey?: string;
  correctValue?: string;
  prefixKey?: string;
  prefixDisplay?: string;
}

const cache = new Map<string, ModelCorrectionEntry[]>();

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function fetchCorrectionsForBrand(brand: string): Promise<ModelCorrectionEntry[]> {
  if (cache.has(brand)) return cache.get(brand)!;

  try {
    const response = await fetch(`/api/model-corrections?brand=${encodeURIComponent(brand)}`);
    if (!response.ok) {
      cache.set(brand, []);
      return [];
    }
    const data = await response.json();
    cache.set(brand, data);
    return data;
  } catch (error) {
    console.error('Failed to fetch model corrections:', error);
    cache.set(brand, []);
    return [];
  }
}

/**
 * Applies any learned corrections for this brand to a raw Model value:
 * exact match first, then a learned prefix-strip, then a learned
 * duplicate-token removal. Returns the value unchanged if nothing
 * learned applies yet — this never invents a correction on its own,
 * it only replays rules a human already confirmed via recordModelVerification.
 */
export async function applyModelCorrections(brand: string, rawValue: string): Promise<string> {
  if (!rawValue.trim()) return rawValue;
  const entries = await fetchCorrectionsForBrand(brand);
  const key = normalizeKey(rawValue);

  const exact = entries.find((e) => e.type === 'exact' && e.rawKey === key);
  if (exact?.correctValue) return exact.correctValue;

  const stripRule = entries.find(
    (e) => e.type === 'strip_prefix' && e.prefixKey && key.startsWith(e.prefixKey)
  );
  if (stripRule?.prefixDisplay) {
    const idx = rawValue.toLowerCase().indexOf(stripRule.prefixDisplay.toLowerCase());
    if (idx === 0) {
      const stripped = rawValue.slice(stripRule.prefixDisplay.length).trim();
      if (stripped) return stripped;
    }
  }

  const hasDedupeRule = entries.some((e) => e.type === 'dedupe_repeat');
  if (hasDedupeRule) {
    const tokens = rawValue.trim().split(/\s+/);
    const seen = new Set<string>();
    const deduped = tokens.filter((t) => {
      const tokenKey = t.toLowerCase();
      if (seen.has(tokenKey)) return false;
      seen.add(tokenKey);
      return true;
    });
    if (deduped.length !== tokens.length) {
      return deduped.join(' ');
    }
  }

  return rawValue;
}

/**
 * Call when a human picks a value for a Model field that had NO
 * automatic match — this is the "verify" step in the 3-layer flow
 * (automatic -> pick -> learn). Invalidates this brand's cache so the
 * next validation pass picks up the freshly learned rule immediately,
 * without waiting for a page reload.
 */
export async function recordModelVerification(brand: string, rawValue: string, correctValue: string): Promise<void> {
  if (!brand || !rawValue || !correctValue) return;
  try {
    await fetch('/api/model-corrections/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, rawValue, correctValue }),
    });
    cache.delete(brand);
  } catch (error) {
    console.error('Failed to record model verification:', error);
  }
}