import type { ExtractedField } from './types';
import { lookupPciId } from '@/lib/shared/pciIds.client';

const DISCRETE_VENDOR_RE = /NVIDIA|Radeon\s+(RX|Pro)|GeForce/i;
const CHIP_NAME_RE = /\[([^\]]+)\]/;
const PCI_ADDRESS_SPLIT_RE = /(?<![\d:.])(?:\d{4}:)?\d{2}:\d{2}\.\d\s/;
const LSPCI_SIGNAL_RE = /controller:/i;
const VENDOR_PREFIX_RE =
  /^(Intel\s+Corporation|NVIDIA\s+Corporation|Advanced\s+Micro\s+Devices(?:,?\s+Inc\.?)?|AMD)\s*/i;
const INTEL_GRAPHICS_WORD_RE = /\bGraphics\b/i;
const CAPACITY_ANYWHERE_RE = /\b(\d+)\s*(MB|GB)\b/i;
const MAXQ_RE = /\s*\/?\s*\bMax-Q\b\s*/gi;
const MOBILE_WORD_RE = /\s*\bMobile\b\s*/gi;
const UNIDENTIFIED_DEVICE_RE = /\bDevice\s+([0-9a-f]{2,6})\b/i;

// PCI-SIG vendor IDs for the three brands this dataset actually has —
// confirmed against the live pci.ids file (e.g. "1002  Advanced Micro
// Devices, Inc. [AMD/ATI]"). Extend this if a new vendor ever shows up.
const VENDOR_HEX: Record<'Intel' | 'NVIDIA' | 'AMD', string> = {
  Intel: '8086',
  NVIDIA: '10de',
  AMD: '1002',
};

function detectVendor(text: string): 'Intel' | 'NVIDIA' | 'AMD' | null {
  if (/NVIDIA/i.test(text)) return 'NVIDIA';
  if (/Intel/i.test(text)) return 'Intel';
  if (/AMD|Advanced Micro Devices|ATI/i.test(text)) return 'AMD';
  return null;
}

function stripTrailingParens(s: string): string {
  let result = s.trim();
  while (/\s*\([^()]*\)\s*$/.test(result)) {
    result = result.replace(/\s*\([^()]*\)\s*$/, '').trim();
  }
  return result;
}

function normalizeVendorPrefix(cleaned: string, vendor: string | null): string {
  if (!vendor) return cleaned;
  const stripped = VENDOR_PREFIX_RE.test(cleaned) ? cleaned.replace(VENDOR_PREFIX_RE, '').trim() : cleaned;
  if (stripped.toLowerCase().startsWith(vendor.toLowerCase())) return stripped;
  return stripped ? `${vendor} ${stripped}` : vendor;
}

function splitControllers(cleaned: string): string[] {
  const parts = cleaned.split(new RegExp(`(?=${PCI_ADDRESS_SPLIT_RE.source})`));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function extractCapacityAndCleanNoise(input: string, vendor: 'Intel' | 'NVIDIA' | 'AMD' | null): { type: string; cap: string | null } {
  let type = input;
  let cap: string | null = null;

  const capMatch = type.match(CAPACITY_ANYWHERE_RE);
  if (capMatch) {
    cap = `${capMatch[1]}${capMatch[2].toUpperCase()}`;
    type = type.replace(CAPACITY_ANYWHERE_RE, ' ');
  }

  type = type.replace(MAXQ_RE, ' ').replace(MOBILE_WORD_RE, ' ');
  if (vendor === 'Intel') type = type.replace(INTEL_GRAPHICS_WORD_RE, ' ');
  type = type.replace(/\s+/g, ' ').trim();

  return { type, cap };
}

export interface GpuFields {
  type: ExtractedField;
  cap: ExtractedField;
}

async function extractFromLspciDump(raw: string, cleaned: string): Promise<GpuFields> {
  const controllers = splitControllers(cleaned);
  const discrete = controllers.find((c) => DISCRETE_VENDOR_RE.test(c));
  const chosen = discrete ?? controllers[0] ?? cleaned;
  const vendor = detectVendor(chosen);

  const chipMatch = chosen.match(CHIP_NAME_RE);
  const raw2 = chipMatch ? chipMatch[1] : chosen.replace(/^.*controller:\s*/i, '').trim();
  const vendorNormalized = normalizeVendorPrefix(stripTrailingParens(raw2), vendor);
  let { type, cap } = extractCapacityAndCleanNoise(vendorNormalized, vendor);

  const deviceIdMatch = type.match(UNIDENTIFIED_DEVICE_RE);
  let resolvedViaPciId = false;

  if (deviceIdMatch && vendor) {
    // lspci couldn't identify this chip locally — look up the raw PCI ID
    // pair against our synced mirror of the public pci.ids database
    // before giving up. Never trusted blindly: the resolved name still
    // goes through the SAME normalization (vendor prefix, Graphics
    // stripping, capacity split) as every other GPU value, and still
    // has to pass the real exact-match check against the live CRM
    // dropdown afterward.
    const pciMatch = await lookupPciId(VENDOR_HEX[vendor], deviceIdMatch[1]);
    if (pciMatch) {
      const bracketMatch = pciMatch.deviceName.match(CHIP_NAME_RE);
      const resolvedRaw = bracketMatch ? bracketMatch[1] : pciMatch.deviceName;
      const normalized = normalizeVendorPrefix(stripTrailingParens(resolvedRaw), vendor);
      const cleanedResult = extractCapacityAndCleanNoise(normalized, vendor);
      type = cleanedResult.type;
      cap = cap ?? cleanedResult.cap;
      resolvedViaPciId = true;
    }
  }

  const isUnidentifiedDevice = !resolvedViaPciId && UNIDENTIFIED_DEVICE_RE.test(type);

  return {
    type: {
      value: type,
      rawSource: raw,
      tier: resolvedViaPciId ? 'suggested' : isUnidentifiedDevice ? 'needs_review' : discrete ? 'suggested' : 'needs_review',
      rule: resolvedViaPciId
        ? 'gpu-pci-id-lookup'
        : isUnidentifiedDevice
          ? 'gpu-unidentified-device'
          : discrete
            ? 'gpu-discrete-preferred'
            : 'gpu-integrated-fallback',
    },
    cap: cap
      ? { value: cap, rawSource: raw, tier: 'suggested', rule: 'gpu-lspci-capacity-anywhere' }
      : { value: '', rawSource: raw, tier: 'missing', rule: 'gpu-cap-not-in-source' },
  };
}

function extractFromDescriptiveText(raw: string, cleaned: string): GpuFields {
  const vendor = detectVendor(cleaned);
  const { type, cap } = extractCapacityAndCleanNoise(cleaned, vendor);

  return {
    type: { value: type, rawSource: raw, tier: 'suggested', rule: 'gpu-descriptive-text' },
    cap: cap
      ? { value: cap, rawSource: raw, tier: 'suggested', rule: 'gpu-descriptive-capacity-anywhere' }
      : { value: '', rawSource: raw, tier: 'missing', rule: 'gpu-cap-not-in-source' },
  };
}

export async function extractGpu(raw: string): Promise<GpuFields> {
  const cleaned = raw.replace(/^b'/, '').replace(/\\n'?$/, '').trim();

  if (!cleaned) {
    return {
      type: { value: '', rawSource: raw, tier: 'missing', rule: 'gpu-empty-source' },
      cap: { value: '', rawSource: raw, tier: 'missing', rule: 'gpu-cap-not-in-source' },
    };
  }

  return LSPCI_SIGNAL_RE.test(cleaned)
    ? extractFromLspciDump(raw, cleaned)
    : extractFromDescriptiveText(raw, cleaned);
}