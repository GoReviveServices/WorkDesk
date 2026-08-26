import type { ExtractedField } from './types';

function dedupeRepeatedPrefix(tokens: string[]): { result: string[]; changed: boolean } {
  const n = tokens.length;
  for (let runLen = Math.floor(n / 2); runLen >= 1; runLen--) {
    const first = tokens.slice(0, runLen);
    const second = tokens.slice(runLen, runLen * 2);
    if (first.length === second.length && first.every((t, i) => t === second[i])) {
      return { result: tokens.slice(runLen), changed: true };
    }
  }
  return { result: tokens, changed: false };
}


function dedupeNarrowFourToken(tokens: string[]): { result: string[]; changed: boolean } {
  if (tokens.length === 4 && tokens[0].toLowerCase() === tokens[2].toLowerCase()) {
    return { result: [tokens[0], tokens[1], tokens[3]], changed: true };
  }
  return { result: tokens, changed: false };
}

function dedupePrefixOfNextToken(tokens: string[]): { result: string[]; changed: boolean } {
  if (
    tokens.length >= 2 &&
    tokens[0].length >= 2 &&
    tokens[0].toLowerCase() !== tokens[1].toLowerCase() &&
    tokens[1].toLowerCase().startsWith(tokens[0].toLowerCase())
  ) {
    return { result: tokens.slice(1), changed: true };
  }
  return { result: tokens, changed: false };
}

export function extractModel(raw: string): ExtractedField {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  const prefixResult = dedupeRepeatedPrefix(tokens);
  if (prefixResult.changed) {
    return { value: prefixResult.result.join(' '), rawSource: raw, tier: 'suggested', rule: 'model-dedupe-exact' };
  }

  const narrowResult = dedupeNarrowFourToken(tokens);
  if (narrowResult.changed) {
    return {
      value: narrowResult.result.join(' '),
      rawSource: raw,
      tier: 'suggested',
      rule: 'model-dedupe-4token',
    };
  }

  const prefixOfNextResult = dedupePrefixOfNextToken(tokens);
  if (prefixOfNextResult.changed) {
    return {
      value: prefixOfNextResult.result.join(' '),
      rawSource: raw,
      tier: 'suggested',
      rule: 'model-dedupe-prefix-of-next',
    };
  }

  return { value: raw.trim(), rawSource: raw, tier: 'needs_review', rule: 'model-no-dedupe' };
}