export function findExactMatch(map: Record<string, string>, rawValue: string): string | null {
  if (Object.prototype.hasOwnProperty.call(map, rawValue)) {
    return map[rawValue];
  }
  return null;
}

export function findWhitespaceInsensitiveMatch(map: Record<string, string>, rawValue: string): string | null {
  const strip = (s: string) => s.replace(/[\s|]+/g, '').toLowerCase();
  const target = strip(rawValue);
  if (!target) return null;

  const matches = Object.keys(map).filter((key) => strip(key) === target);
  return matches.length === 1 ? matches[0] : null;
}

export function findNumericPrecisionMatch(map: Record<string, string>, rawValue: string): string | null {
  const parseTokens = (s: string): { num: number; unit: string }[] | null => {
    const tokens = s.trim().split(/\s+/);
    if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) return null;

    const parsed: { num: number; unit: string }[] = [];
    for (const token of tokens) {
      const match = token.match(/^([\d.]+)([a-zA-Z]*)$/);
      if (!match) return null;
      const num = parseFloat(match[1]);
      if (Number.isNaN(num)) return null;
      parsed.push({ num, unit: match[2].toLowerCase() });
    }
    return parsed;
  };

  const rawTokens = parseTokens(rawValue);
  if (!rawTokens) return null;

  const matches = Object.keys(map).filter((key) => {
    const keyTokens = parseTokens(key);
    if (!keyTokens || keyTokens.length !== rawTokens.length) return false;
    return keyTokens.every((kt, i) => kt.unit === rawTokens[i].unit && kt.num === rawTokens[i].num);
  });

  return matches.length === 1 ? matches[0] : null;
}

// 1000GB and 1024GB (decimal vs binary convention) both mean "1TB".
export function findStorageUnitMatch(map: Record<string, string>, rawValue: string): string | null {
  const m = rawValue.trim().match(/^(\d+(?:\.\d+)?)\s*GB$/i);
  if (!m) return null;
  const gb = parseFloat(m[1]);
  if (gb <= 0) return null;

  const isDecimalTB = gb % 1000 === 0;
  const isBinaryTB = gb % 1024 === 0;
  if (!isDecimalTB && !isBinaryTB) return null;

  const tb = isDecimalTB ? gb / 1000 : gb / 1024;
  const candidates = [`${tb}TB`, `${tb} TB`, `${tb}Tb`, `${tb} Tb`];
  return candidates.find((c) => Object.prototype.hasOwnProperty.call(map, c)) ?? null;
}

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export function suggestClosest(map: Record<string, string>, rawValue: string): string | null {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = normalize(rawValue);
  if (!target) return null;

  for (const key of Object.keys(map)) {
    if (normalize(key) === target) {
      return key;
    }
  }

  return null;
}

export function describeCharDiff(raw: string, expected: string): string | null {
  const len = Math.max(raw.length, expected.length);
  const describe = (c: string | undefined) =>
    c === undefined
      ? '(nothing — string ends here)'
      : `"${c}" (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`;

  for (let i = 0; i < len; i++) {
    if (raw[i] !== expected[i]) {
      return `First difference at character ${i + 1}: your file has ${describe(raw[i])}, system expects ${describe(expected[i])}.`;
    }
  }
  if (raw.length !== expected.length) {
    return `Your value has ${raw.length} characters vs ${expected.length} expected — extra/missing character(s) at the end.`;
  }
  return null;
}