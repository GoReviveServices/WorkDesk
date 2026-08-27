import type { MasterData } from './htmlParsers';
import { getDb } from './mongodb';

// Recommended indexes:
//   db.master_data_cache.createIndex({ _id: 1 })   // default, no action needed
//   db.field_options_cache.createIndex({ action: 1, value: 1 }, { unique: true })

// ---------------------------------------------------------------------------
// Two-tier cache: in-memory (fast, but wiped on every server restart) in
// front of MongoDB (slightly slower, but SURVIVES restarts). Every getter
// now reports WHICH tier answered — 'memory' | 'mongo' | null (a miss,
// meaning the caller must hit legacy) — so routes can surface it in a
// response header for debugging ("is this row hitting the CRM or not").
// ---------------------------------------------------------------------------

export type CacheSource = 'memory' | 'mongo';

const MASTER_DATA_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface MasterDataDoc {
  _id: 'master-data';
  value: MasterData;
  expiresAt: Date;
}

let masterDataMemory: { value: MasterData; expiresAt: number } | null = null;

export async function getCachedMasterData(): Promise<{ value: MasterData; source: CacheSource } | null> {
  if (masterDataMemory && Date.now() < masterDataMemory.expiresAt) {
    return { value: masterDataMemory.value, source: 'memory' };
  }

  try {
    const db = await getDb();
    const doc = await db.collection<MasterDataDoc>('master_data_cache').findOne({ _id: 'master-data' });
    if (!doc || doc.expiresAt.getTime() < Date.now()) return null;
    // An empty object is truthy in JS — without this check, one bad/early
    // fetch (e.g. a race before login fully settles) would get cached and
    // then served as "the real data" for the full TTL.
    if (Object.keys(doc.value).length === 0) return null;

    masterDataMemory = { value: doc.value, expiresAt: doc.expiresAt.getTime() };
    return { value: doc.value, source: 'mongo' };
  } catch (error) {
    console.error('Failed to read master data cache from MongoDB:', error);
    return null; // fall through to a live legacy fetch rather than fail the request
  }
}

export async function setCachedMasterData(value: MasterData): Promise<void> {
  // Never cache an empty scrape result — see getCachedMasterData's guard
  // for why. Letting the route re-fetch next time is strictly better
  // than locking in "nothing" for 30 minutes.
  if (Object.keys(value).length === 0) return;

  const expiresAt = new Date(Date.now() + MASTER_DATA_TTL_MS);
  masterDataMemory = { value, expiresAt: expiresAt.getTime() };

  try {
    const db = await getDb();
    await db
      .collection<MasterDataDoc>('master_data_cache')
      .updateOne({ _id: 'master-data' }, { $set: { value, expiresAt } }, { upsert: true });
  } catch (error) {
    // Non-fatal — the in-memory copy above still serves this process;
    // we just lose restart-survival until the next successful write.
    console.error('Failed to persist master data cache to MongoDB:', error);
  }
}

export async function invalidateMasterData(): Promise<void> {
  masterDataMemory = null;
  try {
    const db = await getDb();
    await db.collection<MasterDataDoc>('master_data_cache').deleteOne({ _id: 'master-data' });
  } catch (error) {
    console.error('Failed to invalidate master data cache in MongoDB:', error);
  }
}

// ---------------------------------------------------------------------------
// field-options: keyed by (action, value) — e.g. action='getModel_masterlist',
// value=<brandId> — one document per BRAND, not per row. No TTL: a given
// brand's category/model list is effectively static within a deploy,
// matching the original client-side dynamicMapCache's assumption. Same
// two-tier (memory -> Mongo -> legacy) pattern, same source-reporting, as
// master data above.
// ---------------------------------------------------------------------------

interface FieldOptionsDoc {
  action: string;
  value: string;
  options: Record<string, string>;
  updatedAt: Date;
}

const fieldOptionsMemory = new Map<string, Record<string, string>>();

function fieldOptionsKey(action: string, value: string): string {
  return `${action}:${value}`;
}

export async function getCachedFieldOptions(
  action: string,
  value: string
): Promise<{ value: Record<string, string>; source: CacheSource } | null> {
  const key = fieldOptionsKey(action, value);
  const memoryHit = fieldOptionsMemory.get(key);
  if (memoryHit) return { value: memoryHit, source: 'memory' };

  try {
    const db = await getDb();
    const doc = await db.collection<FieldOptionsDoc>('field_options_cache').findOne({ action, value });
    if (!doc || Object.keys(doc.options).length === 0) return null;

    fieldOptionsMemory.set(key, doc.options);
    return { value: doc.options, source: 'mongo' };
  } catch (error) {
    console.error(`Failed to read field options cache for ${action}=${value} from MongoDB:`, error);
    return null;
  }
}

export async function setCachedFieldOptions(
  action: string,
  value: string,
  options: Record<string, string>
): Promise<void> {
  if (Object.keys(options).length === 0) return; // same empty-result guard as master data

  fieldOptionsMemory.set(fieldOptionsKey(action, value), options);

  try {
    const db = await getDb();
    await db
      .collection<FieldOptionsDoc>('field_options_cache')
      .updateOne({ action, value }, { $set: { action, value, options, updatedAt: new Date() } }, { upsert: true });
  } catch (error) {
    console.error(`Failed to persist field options cache for ${action}=${value} to MongoDB:`, error);
  }
}