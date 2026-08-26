import { getDb } from './mongodb';

export interface ModelCorrectionDoc {
  type: 'exact' | 'strip_prefix' | 'dedupe_repeat';
  brand: string;
  // 'exact'
  rawKey?: string;
  correctValue?: string;
  verifiedCount?: number;
  // 'strip_prefix'
  prefixKey?: string;
  prefixDisplay?: string;
  exampleRaw: string;
  exampleCorrect: string;
  verifiedAt: Date;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds where `correct`'s alphanumeric content appears, contiguously, in
 * `raw`'s alphanumeric content — the one signal reliable enough to
 * generalize from. If this fails, `correct` isn't a cleaned-up version
 * of `raw`, it's a genuinely different value (or the OCR/extraction
 * mangled something), and inventing a pattern from it would just be a
 * guess wearing a regex costume. Returns the character range in the
 * ORIGINAL raw string (not the stripped core) so the real prefix/suffix
 * text — punctuation, spacing and all — can be extracted for storage.
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
  storedPattern: 'strip_prefix' | 'dedupe_repeat' | null;
}

/**
 * Records a human-confirmed raw->correct Model mapping. Always stores
 * the exact pair. Additionally derives a general, brand-scoped rule
 * ONLY when the pair's relationship is unambiguous:
 *   - strip_prefix: correct's content is raw with a fixed noise prefix
 *     in front of it (e.g. "103C_5335KV HP Notebook HP Laptop " ->
 *     stripping that exact phrase fixes every future row that has it,
 *     regardless of what model code follows).
 *   - dedupe_repeat: raw contains an exact duplicate token (e.g.
 *     "Aspire 7 Aspire A715-42G") — a general per-brand "drop repeated
 *     tokens" rule, since this shape recurred across multiple examples
 *     in the same brand.
 */
export async function recordModelVerification(
  brand: string,
  rawValue: string,
  correctValue: string
): Promise<VerificationResult> {
  const db = await getDb();
  const collection = db.collection<ModelCorrectionDoc>('model_corrections');

  await collection.updateOne(
    { type: 'exact', brand, rawKey: normalizeKey(rawValue) },
    {
      $set: {
        type: 'exact',
        brand,
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
    return { storedExact: true, storedPattern: null };
  }

  const span = findContiguousSpan(rawValue, correctValue);
  if (!span) {
    // No sensible similarity — exact storage is as far as this pair goes.
    return { storedExact: true, storedPattern: null };
  }

  const prefix = rawValue.slice(0, span.start).trim();
  const suffix = rawValue.slice(span.end).trim();

  if (prefix && !suffix) {
    await collection.updateOne(
      { type: 'strip_prefix', brand, prefixKey: normalizeKey(prefix) },
      {
        $set: {
          type: 'strip_prefix',
          brand,
          prefixKey: normalizeKey(prefix),
          prefixDisplay: prefix,
          exampleRaw: rawValue,
          exampleCorrect: correctValue,
          verifiedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return { storedExact: true, storedPattern: 'strip_prefix' };
  }

  const rawTokens = rawValue.trim().split(/\s+/);
  const hasExactDuplicateToken = rawTokens.some((t, i) => rawTokens.findIndex((t2) => t2 === t) !== i);
  if (hasExactDuplicateToken) {
    await collection.updateOne(
      { type: 'dedupe_repeat', brand },
      {
        $set: {
          type: 'dedupe_repeat',
          brand,
          exampleRaw: rawValue,
          exampleCorrect: correctValue,
          verifiedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return { storedExact: true, storedPattern: 'dedupe_repeat' };
  }

  return { storedExact: true, storedPattern: null };
}

export async function getModelCorrectionsForBrand(brand: string): Promise<ModelCorrectionDoc[]> {
  const db = await getDb();
  return db.collection<ModelCorrectionDoc>('model_corrections').find({ brand }).toArray();
}