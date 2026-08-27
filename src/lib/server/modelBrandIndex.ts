import { getDb } from './mongodb';

// RECOMMENDED (not required for correctness — the logic below always
// does a findOne before deciding what to do, so it's safe either way,
// but this makes lookups fast and enforces the invariant at the DB
// level too):
//   db.model_brand_index.createIndex({ rawModelKey: 1 }, { unique: true })

export interface ModelBrandIndexDoc {
  rawModelKey: string; // normalized (trim, lowercase, whitespace-collapsed) — the actual lookup key
  rawModel: string; // original casing, kept for audit
  brand: string; // canonical CRM brand display text
  crmModelMatch: string; // the exact resolved Model dropdown text this was confirmed against
  source: 'auto' | 'manual_pick';
  verifiedAt: Date;
  verifiedCount: number;
}

export interface ModelBrandConflictDoc {
  rawModelKey: string;
  rawModel: string;
  existingBrand: string;
  conflictingBrand: string;
  existingCrmModelMatch: string;
  conflictingCrmModelMatch: string;
  detectedAt: Date;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface LookupResult {
  brand: string;
  crmModelMatch: string;
}

/**
 * A model can only ever belong to one brand — so this is the primary
 * lookup direction the whole design is built around: given raw model
 * text, what brand does it belong to. Independent of the live
 * brand-dropdown cascade (doesn't need a brandId first), which is
 * exactly why it can run BEFORE brand resolution in validateRow and
 * inform it, rather than only confirming it after the fact.
 */
export async function lookupModelBrand(rawModel: string): Promise<LookupResult | null> {
  if (!rawModel.trim()) return null;
  const db = await getDb();
  const doc = await db.collection<ModelBrandIndexDoc>('model_brand_index').findOne({
    rawModelKey: normalizeKey(rawModel),
  });
  return doc ? { brand: doc.brand, crmModelMatch: doc.crmModelMatch } : null;
}

export interface RecordResult {
  stored: boolean;
  conflict: boolean;
}

/**
 * Records a CRM-confirmed (model -> brand) pairing. Called for EVERY
 * successfully validated row at upload time (see the stores), not just
 * manually-corrected ones — a clean auto-match against the live CRM
 * dropdown is just as strong a confirmation as a human's Pick.
 *
 * Never silently overwrites: if this exact raw model text was
 * previously confirmed under a DIFFERENT brand, that's logged as a
 * conflict for manual review instead of picking a winner — the
 * existing entry (and therefore what lookupModelBrand returns) stays
 * exactly as it was until a human resolves it.
 */
export async function recordModelBrandMatch(
  rawModel: string,
  brand: string,
  crmModelMatch: string,
  source: 'auto' | 'manual_pick'
): Promise<RecordResult> {
  if (!rawModel.trim() || !brand.trim()) return { stored: false, conflict: false };

  const db = await getDb();
  const collection = db.collection<ModelBrandIndexDoc>('model_brand_index');
  const key = normalizeKey(rawModel);

  const existing = await collection.findOne({ rawModelKey: key });

  if (existing) {
    if (existing.brand.toLowerCase() === brand.toLowerCase()) {
      // Same brand confirmed again — bump the confidence counter, don't
      // touch the stored casing/crmModelMatch (first-confirmed wins on
      // display text, to avoid it drifting on every re-upload).
      await collection.updateOne({ rawModelKey: key }, { $inc: { verifiedCount: 1 }, $set: { verifiedAt: new Date() } });
      return { stored: true, conflict: false };
    }

    await db.collection<ModelBrandConflictDoc>('model_brand_conflicts').insertOne({
      rawModelKey: key,
      rawModel,
      existingBrand: existing.brand,
      conflictingBrand: brand,
      existingCrmModelMatch: existing.crmModelMatch,
      conflictingCrmModelMatch: crmModelMatch,
      detectedAt: new Date(),
    });
    return { stored: false, conflict: true };
  }

  await collection.insertOne({
    rawModelKey: key,
    rawModel,
    brand,
    crmModelMatch,
    source,
    verifiedAt: new Date(),
    verifiedCount: 1,
  });
  return { stored: true, conflict: false };
}

export async function getModelBrandConflicts(): Promise<ModelBrandConflictDoc[]> {
  const db = await getDb();
  return db
    .collection<ModelBrandConflictDoc>('model_brand_conflicts')
    .find({})
    .sort({ detectedAt: -1 })
    .toArray();
}

export async function bulkLookupModelBrand(rawModels: string[]): Promise<Record<string, LookupResult>> {
  const keys = Array.from(new Set(rawModels.map(normalizeKey).filter(Boolean)));
  const result: Record<string, LookupResult> = {};
  if (keys.length === 0) return result;

  const db = await getDb();
  const docs = await db
    .collection<ModelBrandIndexDoc>('model_brand_index')
    .find({ rawModelKey: { $in: keys } })
    .toArray();

  for (const doc of docs) {
    result[doc.rawModelKey] = { brand: doc.brand, crmModelMatch: doc.crmModelMatch };
  }
  return result;
}