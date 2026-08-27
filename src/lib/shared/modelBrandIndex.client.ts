export interface ModelBrandLookup {
  brand: string;
  crmModelMatch: string;
}

const cache = new Map<string, ModelBrandLookup | null>();

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Prefills the cache from a bootstrap response, avoiding per-model network calls entirely. */
export function preloadModelBrandIndex(entries: Record<string, ModelBrandLookup>): void {
  for (const [key, value] of Object.entries(entries)) {
    cache.set(key, value);
  }
}

export async function lookupModelBrand(rawModel: string): Promise<ModelBrandLookup | null> {
  if (!rawModel.trim()) return null;
  const key = normalizeKey(rawModel);
  if (cache.has(key)) return cache.get(key)!;

  try {
    const response = await fetch(`/api/model-brand-index?model=${encodeURIComponent(rawModel)}`);
    if (!response.ok) return null;
    const data = await response.json();
    cache.set(key, data ?? null);
    return data ?? null;
  } catch (error) {
    console.error('Failed to look up model->brand:', error);
    return null;
  }
}

export interface PendingModelBrandRecord {
  rawModel: string;
  brand: string;
  crmModelMatch: string;
  source: 'auto' | 'manual_pick';
}

export async function recordModelBrandMatch(entry: PendingModelBrandRecord): Promise<void> {
  if (!entry.rawModel || !entry.brand || !entry.crmModelMatch) return;
  try {
    await fetch('/api/model-brand-index/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (error) {
    console.error('Failed to record model->brand match:', error);
  }
}