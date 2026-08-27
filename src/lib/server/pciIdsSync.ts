import { getDb } from './mongodb';

// Recommended: db.pci_ids.createIndex({ vendorHex: 1, deviceHex: 1 }, { unique: true })

const PCI_IDS_URL = 'https://raw.githubusercontent.com/pciutils/pciids/master/pci.ids';

export interface PciIdDoc {
  vendorHex: string; // lowercase 4-hex, e.g. "8086"
  deviceHex: string; // lowercase 4-hex, e.g. "a7a1"
  vendorName: string;
  deviceName: string; // e.g. "Raptor Lake-P [Iris Xe Graphics]"
  syncedAt: Date;
}

/** Parses the pci.ids text format: vendor lines start at column 0, device lines are tab-indented under their vendor. */
function parsePciIds(text: string): PciIdDoc[] {
  const docs: PciIdDoc[] = [];
  let currentVendorHex = '';
  let currentVendorName = '';

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('\t\t')) continue; // subsystem lines — not needed here

    const vendorMatch = line.match(/^([0-9a-f]{4})\s+(.+)$/i);
    if (vendorMatch) {
      currentVendorHex = vendorMatch[1].toLowerCase();
      currentVendorName = vendorMatch[2].trim();
      continue;
    }

    const deviceMatch = line.match(/^\t([0-9a-f]{4})\s+(.+)$/i);
    if (deviceMatch && currentVendorHex) {
      docs.push({
        vendorHex: currentVendorHex,
        deviceHex: deviceMatch[1].toLowerCase(),
        vendorName: currentVendorName,
        deviceName: deviceMatch[2].trim(),
        syncedAt: new Date(),
      });
    }
  }

  return docs;
}

export interface SyncResult {
  entriesSynced: number;
}

export async function syncPciIds(): Promise<SyncResult> {
  const response = await fetch(PCI_IDS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch pci.ids: ${response.status}`);
  }
  const text = await response.text();
  const docs = parsePciIds(text);

  const db = await getDb();
  const collection = db.collection<PciIdDoc>('pci_ids');

  // Bulk replace: simpler and fast enough for a monthly-ish sync of ~40k
  // entries, and avoids stale entries lingering after upstream removals.
  await collection.deleteMany({});
  if (docs.length > 0) {
    const BATCH_SIZE = 5000;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      await collection.insertMany(docs.slice(i, i + BATCH_SIZE));
    }
  }

  return { entriesSynced: docs.length };
}

export async function lookupPciId(vendorHex: string, deviceHex: string): Promise<PciIdDoc | null> {
  const db = await getDb();
  return db.collection<PciIdDoc>('pci_ids').findOne({
    vendorHex: vendorHex.toLowerCase(),
    deviceHex: deviceHex.toLowerCase(),
  });
}