export interface ModelBrandLookup {
  brand: string;
  crmModelMatch: string;
}

export async function lookupModelBrand(rawModel: string): Promise<ModelBrandLookup | null> {
  if (!rawModel.trim()) return null;
  try {
    const response = await fetch(`/api/model-brand-index?model=${encodeURIComponent(rawModel)}`);
    if (!response.ok) return null;
    const data = await response.json();
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