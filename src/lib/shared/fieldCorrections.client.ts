import { isSafeToLearnExactMatch } from './fieldSpecificity';
import { MIN_PATTERN_EVIDENCE } from './learningConfig';

export interface FieldCorrectionEntry {
  type: 'exact' | 'strip_prefix' | 'strip_suffix' | 'dedupe_repeat';
  rawKey?: string;
  correctValue?: string;
  prefixKey?: string;
  prefixDisplay?: string;
  suffixKey?: string;
  suffixDisplay?: string;
  verifiedCount: number;
}

export interface PendingCorrection {
  field: string;
  scope: string;
  rawValue: string;
  correctValue: string;
}

const cache = new Map<string, FieldCorrectionEntry[]>();

function cacheKey(field: string, scope: string): string {
  return `${field}:${scope}`;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function fetchCorrections(field: string, scope: string): Promise<FieldCorrectionEntry[]> {
  const key = cacheKey(field, scope);
  if (cache.has(key)) return cache.get(key)!;

  try {
    const params = new URLSearchParams({ field, scope });
    const response = await fetch(`/api/field-corrections?${params.toString()}`);
    if (!response.ok) {
      cache.set(key, []);
      return [];
    }
    const data = await response.json();
    cache.set(key, data);
    return data;
  } catch (error) {
    console.error('Failed to fetch field corrections:', error);
    cache.set(key, []);
    return [];
  }
}

/**
 * Applies any learned corrections for this (field, scope) to a raw
 * value: exact match first (applies immediately — see below), then a
 * learned prefix-strip, then a learned suffix-strip, then a learned
 * duplicate-token removal — but PATTERN rules (the last three) only
 * apply once they've reached MIN_PATTERN_EVIDENCE confirmations across
 * distinct raw values. A pattern derived from a single Pick is held as
 * a "candidate" (visible in Mongo, not yet auto-applied) until enough
 * independent evidence accumulates — this is what stops one fluke
 * example from becoming a general rule. 'exact' pairs skip this gate
 * entirely: reusing one literal string for that same string again is
 * memorization, not generalization, so it's safe on the first confirmation.
 *
 * `scope` is the brand name for brand-dependent fields (Model), or
 * 'global' for brand-independent static dropdown fields (cpu_core,
 * gpu_type, etc. — those share one master list regardless of brand).
 */
export async function applyFieldCorrections(field: string, scope: string, rawValue: string): Promise<string> {
  if (!rawValue.trim()) return rawValue;
  if (!isSafeToLearnExactMatch(field, rawValue)) {
    // Defense in depth: even if a correction somehow exists for this
    // (field, rawValue) — e.g. written before this guard existed —
    // never replay it. A generic vendor-only raw text isn't reliably
    // the same real value every time it appears.
    return rawValue;
  }

  const entries = await fetchCorrections(field, scope);
  const key = normalizeKey(rawValue);

  const exact = entries.find((e) => e.type === 'exact' && e.rawKey === key);
  if (exact?.correctValue) return exact.correctValue;

  const stripPrefixRule = entries.find(
    (e) => e.type === 'strip_prefix' && e.verifiedCount >= MIN_PATTERN_EVIDENCE && e.prefixKey && key.startsWith(e.prefixKey)
  );
  if (stripPrefixRule?.prefixDisplay) {
    const idx = rawValue.toLowerCase().indexOf(stripPrefixRule.prefixDisplay.toLowerCase());
    if (idx === 0) {
      const stripped = rawValue.slice(stripPrefixRule.prefixDisplay.length).trim();
      if (stripped) return stripped;
    }
  }

  const stripSuffixRule = entries.find(
    (e) => e.type === 'strip_suffix' && e.verifiedCount >= MIN_PATTERN_EVIDENCE && e.suffixKey && key.endsWith(e.suffixKey)
  );
  if (stripSuffixRule?.suffixDisplay) {
    const idx = rawValue.toLowerCase().lastIndexOf(stripSuffixRule.suffixDisplay.toLowerCase());
    if (idx !== -1 && idx + stripSuffixRule.suffixDisplay.length === rawValue.length) {
      const stripped = rawValue.slice(0, idx).trim();
      if (stripped) return stripped;
    }
  }

  const hasDedupeRule = entries.some((e) => e.type === 'dedupe_repeat' && e.verifiedCount >= MIN_PATTERN_EVIDENCE);
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

export interface RecordVerificationResult {
  storedExact: boolean;
  storedPattern: 'strip_prefix' | 'strip_suffix' | 'dedupe_repeat' | null;
  patternEvidenceCount: number;
  patternJustActivated: boolean;
}

/**
 * Call when a human picks a value for a field that had NO automatic
 * match — the "verify" step in the 3-layer flow (automatic -> pick ->
 * learn), now available for any field, not just Model. Invalidates this
 * (field, scope)'s cache so the next validation pass picks up any
 * freshly-activated rule immediately. Returns the evidence-tracking
 * result so callers can show progress ("2/3 confirmations") or a
 * just-activated notice, rather than a silent fire-and-forget.
 */
export async function recordFieldVerification(
  field: string,
  scope: string,
  rawValue: string,
  correctValue: string
): Promise<RecordVerificationResult | null> {
  if (!field || !scope || !rawValue || !correctValue) return null;
  try {
    const response = await fetch('/api/field-corrections/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, scope, rawValue, correctValue }),
    });
    cache.delete(cacheKey(field, scope));
    if (!response.ok) return null;
    const result = await response.json();
    return result.ok ? result : null;
  } catch (error) {
    console.error('Failed to record field verification:', error);
    return null;
  }
}