export interface CategoryMapEntry {
  category: string;
  subCategories: string[];
}

let cachedCategoryMap: CategoryMapEntry[] | null = null;

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

/**
 * Detects a Category <-> Sub Category field swap: a value typed into
 * `product_name` (Category) that actually matches a known SUB-category
 * name, or a value typed into `sub_producd` (Sub Category) that actually
 * matches a known CATEGORY name. Exact match only (case-insensitive) —
 * this catches "put it in the wrong field entirely", not typos; typo
 * correction is already handled by suggestClosest against the correct
 * field's own dropdown.
 */
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

/**
 * Applies the same Category/Sub Category placement correction as
 * detectFieldSwap, but returns a corrected copy of the actual "original"
 * record — the raw value the review table displays — rather than just
 * informing validation internally. Call this at ingestion time (when
 * rows/groups first enter the app), not inside validateRow, so the
 * table visibly shows the corrected placement instead of silently
 * resolving it behind the scenes while still displaying the wrong field.
 * Only applies when the OTHER field is empty, so two genuinely distinct
 * values already present in both fields are never overwritten.
 */
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