import type { MasterData } from './htmlParsers';

// NOTE: in-memory, per server instance — fine for a small internal team on
// a single instance; if traffic/instance-count grows enough that this
// stops being effectively shared, swap the Map-backed storage below for
// Vercel KV (or similar) behind these same function signatures. Nothing
// outside this file needs to change.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MASTER_DATA_KEY = 'master-data';
const MASTER_DATA_TTL_MS = 30 * 60 * 1000; // 30 minutes

const masterDataStore = new Map<string, CacheEntry<MasterData>>();

export function getCachedMasterData(): MasterData | null {
  const entry = masterDataStore.get(MASTER_DATA_KEY);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    masterDataStore.delete(MASTER_DATA_KEY);
    return null;
  }
  return entry.value;
}

export function setCachedMasterData(value: MasterData): void {
  masterDataStore.set(MASTER_DATA_KEY, { value, expiresAt: Date.now() + MASTER_DATA_TTL_MS });
}

export function invalidateMasterData(): void {
  masterDataStore.delete(MASTER_DATA_KEY);
}

// field-options: keyed by `${action}:${value}`, no TTL — matches the
// original client-side dynamicMapCache's assumption that a given
// brand/category's dropdown options are effectively static within a
// deploy. Moved server-side here so it's shared across users/tabs
// instead of reset per browser session.
const fieldOptionsStore = new Map<string, Record<string, string>>();

function fieldOptionsKey(action: string, value: string): string {
  return `${action}:${value}`;
}

export function getCachedFieldOptions(action: string, value: string): Record<string, string> | null {
  return fieldOptionsStore.get(fieldOptionsKey(action, value)) ?? null;
}

export function setCachedFieldOptions(
  action: string,
  value: string,
  options: Record<string, string>
): void {
  fieldOptionsStore.set(fieldOptionsKey(action, value), options);
}