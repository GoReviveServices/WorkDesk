const cache = new Map<string, { vendorName: string; deviceName: string } | null>();

export async function lookupPciId(vendorHex: string, deviceHex: string): Promise<{ vendorName: string; deviceName: string } | null> {
  const key = `${vendorHex}:${deviceHex}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const response = await fetch(`/api/pci-ids/lookup?vendor=${vendorHex}&device=${deviceHex}`);
    const result = response.ok ? await response.json() : null;
    cache.set(key, result);
    return result;
  } catch (error) {
    console.error('Failed to look up PCI ID:', error);
    cache.set(key, null);
    return null;
  }
}