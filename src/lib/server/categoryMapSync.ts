import { legacyRequest } from './legacyClient';
import { htmlToJson, parseHtmlOptionsExact, looksLikeLoginPage } from './htmlParsers';
import { getDb } from './mongodb';

export interface CategoryMapDoc {
  category: string;
  sub_categories: string[];
  updatedAt: Date;
}

export interface SyncResult {
  brandsScanned: number;
  categoriesFound: number;
  subCategoriesFound: number;
}

// Polite delay between legacy-backend calls — this crawl hits dozens of
// brand/category combinations sequentially; we don't want to hammer the
// legacy server the way a parallel Promise.all would.
const CRAWL_DELAY_MS = 150;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crawls the legacy CRM's full brand -> category -> sub-category
 * hierarchy and upserts a category-keyed document per category into
 * MongoDB. Requires an authenticated legacy session (same cookie the
 * other proxy routes forward) since this hits the same endpoints they do.
 */
export async function syncCategoryMap(legacySessionCookie: string): Promise<SyncResult> {
  // 1. Master brand list.
  const masterResult = await legacyRequest('/master/addmodel_new_all.php', {
    method: 'GET',
    legacySessionCookie,
  });
  if (looksLikeLoginPage(masterResult.data)) {
    throw new Error('Legacy session expired or invalid.');
  }
  const master = htmlToJson(masterResult.data);
  const brandIds = Object.values(master.make || {});

  // category display name -> Set(sub-category display names), built up
  // across every brand that references it.
  const categoryToSubs = new Map<string, Set<string>>();
  // categoryId -> already fetched, so multiple brands sharing a category
  // don't trigger a duplicate sub-category fetch.
  const seenCategoryIds = new Set<string>();

  let brandsScanned = 0;
  for (const brandId of brandIds) {
    brandsScanned++;

    const categoryResult = await legacyRequest('/includes/getField.php', {
      method: 'POST',
      data: new URLSearchParams({ action: 'getProductName_master', value: brandId }),
      legacySessionCookie,
    });
    if (looksLikeLoginPage(categoryResult.data)) {
      throw new Error('Legacy session expired or invalid mid-crawl.');
    }
    const categories = parseHtmlOptionsExact(categoryResult.data.split('~')[0]);

    for (const [categoryName, categoryId] of Object.entries(categories)) {
      if (!categoryToSubs.has(categoryName)) {
        categoryToSubs.set(categoryName, new Set());
      }
      if (seenCategoryIds.has(categoryId)) continue;
      seenCategoryIds.add(categoryId);

      await sleep(CRAWL_DELAY_MS);
      const subResult = await legacyRequest('/includes/getField.php', {
        method: 'POST',
        data: new URLSearchParams({ action: 'getsubProductName_master', value: categoryId }),
        legacySessionCookie,
      });
      if (looksLikeLoginPage(subResult.data)) {
        throw new Error('Legacy session expired or invalid mid-crawl.');
      }
      const subs = parseHtmlOptionsExact(subResult.data.split('~')[0]);
      Object.keys(subs).forEach((subName) => categoryToSubs.get(categoryName)!.add(subName));
    }

    await sleep(CRAWL_DELAY_MS);
  }

  // 2. Upsert one document per category.
  const db = await getDb();
  const collection = db.collection<CategoryMapDoc>('category_map');

  let subCategoriesFound = 0;
  for (const [category, subs] of categoryToSubs.entries()) {
    const sub_categories = Array.from(subs).sort();
    subCategoriesFound += sub_categories.length;
    await collection.updateOne(
      { category },
      { $set: { category, sub_categories, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  return { brandsScanned, categoriesFound: categoryToSubs.size, subCategoriesFound };
}
export async function getCategoryMap(): Promise<CategoryMapDoc[]> {
  const db = await getDb();
  return db.collection<CategoryMapDoc>('category_map').find({}).toArray();
}