export interface CategoryMapEntry {
  category: string;
  subCategories: string[];
}

let cachedCategoryMap: CategoryMapEntry[] | null = null;

/** Prefills the cache from a bootstrap response, skipping the /api/category-map round trip. */
export function preloadCategoryMap(entries: CategoryMapEntry[]): void {
  cachedCategoryMap = entries;
}

export async function fetchCategoryMap(): Promise<CategoryMapEntry[]> {
  if (cachedCategoryMap) return cachedCategoryMap;

  try {
    const response = await fetch('/api/category-map');
    if (!response.ok) {
      console.error('Failed to fetch category map:', response.status);
      cachedCategoryMap = [];
      return cachedCategoryMap;
    }
    cachedCategoryMap = await response.json();
    return cachedCategoryMap!;
  } catch (error) {
    console.error('Failed to fetch category map:', error);
    cachedCategoryMap = [];
    return cachedCategoryMap;
  }
}

export interface FieldSwapSuggestion {
  correctCategory: string;
  /** Empty string when we know the category but not which sub-category was intended. */
  correctSubCategory: string;
}

export async function detectFieldSwap(
  fieldKey: 'product_name' | 'sub_producd',
  rawValue: string
): Promise<FieldSwapSuggestion | null> {
  if (!rawValue.trim()) return null;

  const map = await fetchCategoryMap();
  const normalized = rawValue.trim().toLowerCase();

  if (fieldKey === 'product_name') {
    for (const entry of map) {
      const match = entry.subCategories.find((s) => s.toLowerCase() === normalized);
      if (match) {
        return { correctCategory: entry.category, correctSubCategory: match };
      }
    }
    return null;
  }

  const match = map.find((entry) => entry.category.toLowerCase() === normalized);
  return match ? { correctCategory: match.category, correctSubCategory: '' } : null;
}


export async function correctCategoryPlacement(
  original: Record<string, string>
): Promise<Record<string, string>> {
  const corrected = { ...original };

  if (corrected.product_name && !corrected.sub_producd) {
    const swap = await detectFieldSwap('product_name', corrected.product_name);
    if (swap) {
      corrected.product_name = swap.correctCategory;
      corrected.sub_producd = swap.correctSubCategory;
    }
  } else if (corrected.sub_producd && !corrected.product_name) {
    const swap = await detectFieldSwap('sub_producd', corrected.sub_producd);
    if (swap) {
      corrected.product_name = swap.correctCategory;
      corrected.sub_producd = '';
    }
  }

  return corrected;
}