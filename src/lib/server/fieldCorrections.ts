import type { Collection } from 'mongodb';
import { getDb } from './mongodb';
import { isSafeToLearnExactMatch } from '@/lib/shared/fieldSpecificity';
import { MIN_PATTERN_EVIDENCE } from '@/lib/shared/learningConfig';

export interface FieldCorrectionDoc {
  type: 'exact' | 'strip_prefix' | 'strip_suffix' | 'dedupe_repeat';
  field: string; // 'model' | 'cpu_core' | 'gpu_type' | 'make' | any other field key
  /** Brand name for brand-dependent fields (e.g. 'model'); 'global' for brand-independent static fields. */
  scope: string;
  // 'exact'
  rawKey?: string;
  correctValue?: string;
  // 'strip_prefix'
  prefixKey?: string;
  prefixDisplay?: string;
  // 'strip_suffix'
  suffixKey?: string;
  suffixDisplay?: string;
  exampleRaw: string;
  exampleCorrect: string;
  verifiedAt: Date;
  /**
   * How many independent confirmations this specific doc has. For
   * PATTERN docs (strip_prefix/strip_suffix/dedupe_repeat), this gates
   * whether it's eligible to auto-apply (see fieldCorrections.client.ts)
   * — reaching MIN_PATTERN_EVIDENCE means the SAME structural pattern
   * was confirmed across that many distinct raw values, not just one
   * anecdote. 'exact' docs ignore this gate and always apply.
   */
  verifiedCount: number;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds where `correct`'s alphanumeric content appears, contiguously, in
 * `raw`'s alphanumeric content — the one signal reliable enough to
 * generalize from. If this fails, `correct` isn't a cleaned-up version
 * of `raw`, it's a genuinely different value, and inventing a pattern
 * from it would just be a guess wearing a regex costume.
 */
function findContiguousSpan(raw: string, correct: string): { start: number; end: number } | null {
  const stripNonAlnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawCore = stripNonAlnum(raw);
  const correctCore = stripNonAlnum(correct);
  if (!correctCore) return null;

  const coreIndex = rawCore.indexOf(correctCore);
  if (coreIndex === -1) return null;

  let coreCount = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < raw.length; i++) {
    if (/[a-zA-Z0-9]/.test(raw[i])) {
      if (coreCount === coreIndex) start = i;
      coreCount++;
      if (coreCount === coreIndex + correctCore.length) {
        end = i + 1;
        break;
      }
    }
  }
  return start === -1 || end === -1 ? null : { start, end };
}

export interface VerificationResult {
  storedExact: boolean;
  storedPattern: 'strip_prefix' | 'strip_suffix' | 'dedupe_repeat' | null;
  /** How many times THIS specific pattern has now been confirmed. */
  patternEvidenceCount: number;
  /** True if this confirmation just pushed the pattern to (or past) the auto-apply threshold. */
  patternJustActivated: boolean;
}

/**
 * Upserts a pattern doc and atomically bumps its evidence counter, then
 * reports whether this confirmation just crossed the auto-apply
 * threshold — used identically for strip_prefix, strip_suffix, and
 * dedupe_repeat below.
 */
async function upsertPatternWithEvidence(
  collection: Collection<FieldCorrectionDoc>,
  filter: Record<string, unknown>,
  setFields: Record<string, unknown>
): Promise<{ evidenceCount: number; justActivated: boolean }> {
  const before = await collection.findOne(filter as Partial<FieldCorrectionDoc>);
  const beforeCount = before?.verifiedCount ?? 0;

  await collection.updateOne(filter as Partial<FieldCorrectionDoc>, { $set: setFields, $inc: { verifiedCount: 1 } }, { upsert: true });

  const evidenceCount = beforeCount + 1;
  const justActivated = beforeCount < MIN_PATTERN_EVIDENCE && evidenceCount >= MIN_PATTERN_EVIDENCE;
  return { evidenceCount, justActivated };
}

/**
 * Records a human-confirmed raw->correct mapping for ANY field. Always
 * stores the exact pair (applies immediately — see FieldCorrectionDoc's
 * verifiedCount doc comment for why). Additionally derives a general,
 * (field, scope)-scoped PATTERN when the pair's relationship is
 * unambiguous (see findContiguousSpan) — but that pattern only becomes
 * usable once MIN_PATTERN_EVIDENCE distinct raw values have confirmed
 * the same structural shape, not from this one call alone.
 */
export async function recordFieldVerification(
  field: string,
  scope: string,
  rawValue: string,
  correctValue: string
): Promise<VerificationResult> {
  if (!isSafeToLearnExactMatch(field, rawValue)) {
    // Raw text too generic to reliably identify one specific value for
    // this field — refuse to learn ANYTHING from this pair.
    return { storedExact: false, storedPattern: null, patternEvidenceCount: 0, patternJustActivated: false };
  }

  const db = await getDb();
  const collection = db.collection<FieldCorrectionDoc>('field_corrections');

  await collection.updateOne(
    { type: 'exact', field, scope, rawKey: normalizeKey(rawValue) },
    {
      $set: {
        type: 'exact',
        field,
        scope,
        rawKey: normalizeKey(rawValue),
        correctValue,
        exampleRaw: rawValue,
        exampleCorrect: correctValue,
        verifiedAt: new Date(),
      },
      $inc: { verifiedCount: 1 },
    },
    { upsert: true }
  );

  if (normalizeKey(rawValue) === normalizeKey(correctValue)) {
    return { storedExact: true, storedPattern: null, patternEvidenceCount: 0, patternJustActivated: false };
  }

  const span = findContiguousSpan(rawValue, correctValue);
  if (!span) {
    return { storedExact: true, storedPattern: null, patternEvidenceCount: 0, patternJustActivated: false };
  }

  const prefix = rawValue.slice(0, span.start).trim();
  const suffix = rawValue.slice(span.end).trim();

  if (prefix && !suffix) {
    const filter = { type: 'strip_prefix', field, scope, prefixKey: normalizeKey(prefix) };
    const { evidenceCount, justActivated } = await upsertPatternWithEvidence(collection, filter, {
      type: 'strip_prefix',
      field,
      scope,
      prefixKey: normalizeKey(prefix),
      prefixDisplay: prefix,
      exampleRaw: rawValue,
      exampleCorrect: correctValue,
      verifiedAt: new Date(),
    });
    return {
      storedExact: true,
      storedPattern: 'strip_prefix',
      patternEvidenceCount: evidenceCount,
      patternJustActivated: justActivated,
    };
  }

  // Symmetric to strip_prefix — e.g. Lenovo's "ThinkPad T490 20N3S9KY0C"
  // -> "ThinkPad T490": a trailing unit-serial code needs stripping.
  if (suffix && !prefix) {
    const filter = { type: 'strip_suffix', field, scope, suffixKey: normalizeKey(suffix) };
    const { evidenceCount, justActivated } = await upsertPatternWithEvidence(collection, filter, {
      type: 'strip_suffix',
      field,
      scope,
      suffixKey: normalizeKey(suffix),
      suffixDisplay: suffix,
      exampleRaw: rawValue,
      exampleCorrect: correctValue,
      verifiedAt: new Date(),
    });
    return {
      storedExact: true,
      storedPattern: 'strip_suffix',
      patternEvidenceCount: evidenceCount,
      patternJustActivated: justActivated,
    };
  }

  const rawTokens = rawValue.trim().split(/\s+/);
  const hasExactDuplicateToken = rawTokens.some((t, i) => rawTokens.findIndex((t2) => t2 === t) !== i);
  if (hasExactDuplicateToken) {
    const filter = { type: 'dedupe_repeat', field, scope };
    const { evidenceCount, justActivated } = await upsertPatternWithEvidence(collection, filter, {
      type: 'dedupe_repeat',
      field,
      scope,
      exampleRaw: rawValue,
      exampleCorrect: correctValue,
      verifiedAt: new Date(),
    });
    return {
      storedExact: true,
      storedPattern: 'dedupe_repeat',
      patternEvidenceCount: evidenceCount,
      patternJustActivated: justActivated,
    };
  }

  return { storedExact: true, storedPattern: null, patternEvidenceCount: 0, patternJustActivated: false };
}

export async function getFieldCorrections(field: string, scope: string): Promise<FieldCorrectionDoc[]> {
  const db = await getDb();
  return db.collection<FieldCorrectionDoc>('field_corrections').find({ field, scope }).toArray();
}