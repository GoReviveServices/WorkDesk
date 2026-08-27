import type { ExtractedField } from './types';

const INTEL_AT_RE =
  /(?:(\d+)(?:st|nd|rd|th)\s+Gen\s+)?(Intel\s+Core\s+i[3579])-(\w+)\s+(?:CPU\s+)?@\s+([\d.]+)\s*GHz(?:\s+([\d.]+)\s*GHz)?/i;
const INTEL_NOAT_RE = /(?:(\d+)(?:st|nd|rd|th)\s+Gen\s+)?(Intel\s+Core\s+i[3579])-(\w+)\s+([\d.]+)\s*GHz/i;
const CELERON_RE = /Intel\s+Celeron\s+(?:CPU\s+)?(\S+)\s+(?:CPU\s+)?@\s+([\d.]+)\s*GHz(?:\s+([\d.]+)\s*GHz)?/i;
const AMD_NAMED_RE = /AMD\s+((?:Ryzen\s+[3579]|Athlon)\s+\w+)\s+with.*?([\d.]+)\s*GHz/i;
const AMD_AT_RE = /AMD\s+(.+?)\s+@\s+([\d.]+)\s*GHz(?:\s+([\d.]+)\s*GHz)?/i;
const AMD_GENERIC_RE = /AMD\s+([\w.-]+)/i;
const LAST_GHZ_RE = /([\d.]+)\s*GHz/gi;
const MODEL_DIGITS_RE = /^(\d+)/;
const AMD_NAMED_SPLIT_RE = /^(Ryzen\s+[3579]|Athlon)\s+(\S+)$/i;
const AMD_HYPHEN_SPLIT_RE = /^([A-Za-z]+\d*)-(\S+)$/i;

function lastGhzMatch(raw: string): string | null {
  const matches = [...raw.matchAll(LAST_GHZ_RE)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function formatSpeed(baseClock: string, boostClock?: string): string {
  return boostClock ? `${baseClock}GHz ${boostClock}GHz` : `${baseClock}GHz`;
}

// Same digit-count-isn't-reliable logic as before, now applied directly
// to the model-number token instead of a full "iX-NNNNN" descriptor.
function inferIntelGen(modelDigits: string): string | null {
  const match = modelDigits.match(MODEL_DIGITS_RE);
  if (!match) return null;
  const digits = match[1];
  const genDigits =
    digits[0] === '1' && digits.length > 1 && '01234'.includes(digits[1]) ? digits.slice(0, 2) : digits.slice(0, 1);
  return `${genDigits}th Gen`;
}

// Splits an AMD chip identifier into short core + series, e.g.
// "Ryzen 7 5800H" -> ("Ryzen 7", "5800H"), "A9-9420" -> ("A9", "9420").
// Chips with no clean separator (e.g. "3020e") return no series — same
// as today's behavior, not a regression.
function splitAmdChip(chip: string): { core: string; series: string } {
  const named = chip.match(AMD_NAMED_SPLIT_RE);
  if (named) return { core: named[1], series: named[2] };
  const hyphenated = chip.match(AMD_HYPHEN_SPLIT_RE);
  if (hyphenated) return { core: hyphenated[1], series: hyphenated[2] };
  return { core: chip, series: '' };
}

export interface CpuFields {
  core: ExtractedField;
  gen: ExtractedField;
  speed: ExtractedField;
  /** Model-number suffix (5800H, 6200U, etc.) — sheet/audit only, never submitted (no backend field for it). */
  series: string;
}

export function extractCpu(raw: string): CpuFields {
  const intelAt = raw.match(INTEL_AT_RE);
  if (intelAt) {
    const [, genPrefix, coreShort, series, baseClock, boostClock] = intelAt;
    const gen = genPrefix ? `${genPrefix}th Gen` : inferIntelGen(series);
    return {
      core: { value: coreShort, rawSource: raw, tier: 'matched', rule: 'cpu-intel-at-core' },
      gen: {
        value: gen ?? '',
        rawSource: raw,
        tier: gen ? 'suggested' : 'missing',
        rule: gen ? 'cpu-intel-gen-inferred' : 'cpu-intel-gen-unresolved',
      },
      speed: { value: formatSpeed(baseClock, boostClock), rawSource: raw, tier: 'needs_review', rule: 'cpu-intel-at-speed' },
      series,
    };
  }

  const intelNoAt = raw.match(INTEL_NOAT_RE);
  if (intelNoAt) {
    const [, genPrefix, coreShort, series, speed] = intelNoAt;
    const gen = genPrefix ? `${genPrefix}th Gen` : inferIntelGen(series);
    return {
      core: { value: coreShort, rawSource: raw, tier: 'matched', rule: 'cpu-intel-noat-core' },
      gen: {
        value: gen ?? '',
        rawSource: raw,
        tier: gen ? 'suggested' : 'missing',
        rule: gen ? 'cpu-intel-gen-inferred' : 'cpu-intel-gen-unresolved',
      },
      speed: { value: formatSpeed(speed), rawSource: raw, tier: 'needs_review', rule: 'cpu-intel-noat-speed' },
      series,
    };
  }

  const celeron = raw.match(CELERON_RE);
  if (celeron) {
    const [, series, baseClock, boostClock] = celeron;
    return {
      core: { value: 'Intel Celeron', rawSource: raw, tier: 'matched', rule: 'cpu-celeron-core' },
      gen: { value: '', rawSource: raw, tier: 'missing', rule: 'cpu-celeron-no-gen' },
      speed: { value: formatSpeed(baseClock, boostClock), rawSource: raw, tier: 'needs_review', rule: 'cpu-celeron-speed' },
      series,
    };
  }

  const amdNamed = raw.match(AMD_NAMED_RE);
  if (amdNamed) {
    const [, chipName, clock] = amdNamed;
    const { core, series } = splitAmdChip(chipName);
    return {
      core: { value: `AMD ${core}`.trim(), rawSource: raw, tier: 'matched', rule: 'cpu-amd-named-core' },
      gen: { value: '', rawSource: raw, tier: 'missing', rule: 'cpu-amd-no-gen' },
      speed: { value: formatSpeed(clock), rawSource: raw, tier: 'needs_review', rule: 'cpu-amd-named-speed' },
      series,
    };
  }

  const amdAt = raw.match(AMD_AT_RE);
  if (amdAt) {
    const [, chipName, baseClock, boostClock] = amdAt;
    const { core, series } = splitAmdChip(chipName);
    return {
      core: { value: `AMD ${core}`.trim(), rawSource: raw, tier: 'matched', rule: 'cpu-amd-at-core' },
      gen: { value: '', rawSource: raw, tier: 'missing', rule: 'cpu-amd-no-gen' },
      speed: { value: formatSpeed(baseClock, boostClock), rawSource: raw, tier: 'needs_review', rule: 'cpu-amd-at-speed' },
      series,
    };
  }

  const amdGeneric = raw.match(AMD_GENERIC_RE);
  const ghz = lastGhzMatch(raw);
  if (amdGeneric && ghz) {
    const { core, series } = splitAmdChip(amdGeneric[1]);
    return {
      core: { value: `AMD ${core}`.trim(), rawSource: raw, tier: 'suggested', rule: 'cpu-amd-generic-core' },
      gen: { value: '', rawSource: raw, tier: 'missing', rule: 'cpu-amd-no-gen' },
      speed: { value: formatSpeed(ghz), rawSource: raw, tier: 'needs_review', rule: 'cpu-amd-generic-speed' },
      series,
    };
  }

  return {
    core: { value: '', rawSource: raw, tier: 'needs_review', rule: 'cpu-unrecognized' },
    gen: { value: '', rawSource: raw, tier: 'needs_review', rule: 'cpu-unrecognized' },
    speed: { value: '', rawSource: raw, tier: 'needs_review', rule: 'cpu-unrecognized' },
    series: '',
  };
}