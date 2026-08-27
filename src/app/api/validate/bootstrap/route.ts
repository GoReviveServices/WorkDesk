import { NextRequest, NextResponse } from 'next/server';
import { getBulkFieldCorrections } from '@/lib/server/fieldCorrections';
import { bulkLookupModelBrand } from '@/lib/server/modelBrandIndex';
import { getCategoryMap } from '@/lib/server/categoryMapSync';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

const STATIC_DROPDOWN_FIELDS = [
  'hsn_code', 'ram_cap', 'strg1', 'strg2', 'cpu_core', 'cpu_gen',
  'cpu_speed', 'color', 'gpu_type', 'gpu_cap', 'display_type', 'display_size',
] as const;

export async function POST(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: { rawModels?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const rawModels = Array.isArray(body.rawModels) ? body.rawModels : [];

  try {
    // All three of these share the SAME cached Mongo connection
    // (see lib/server/mongodb.ts) — this whole bootstrap costs one
    // connection to Atlas, not one per field/model like before.
    const globalFieldPairs = [...STATIC_DROPDOWN_FIELDS, 'make'].map((field) => ({
      field,
      scope: 'global',
    }));

    const [corrections, modelBrandIndex, categoryMapDocs] = await Promise.all([
      getBulkFieldCorrections(globalFieldPairs),
      bulkLookupModelBrand(rawModels),
      getCategoryMap(),
    ]);

    const categoryMap = categoryMapDocs.map((doc) => ({
      category: doc.category,
      subCategories: doc.sub_categories,
    }));

    return NextResponse.json({ corrections, modelBrandIndex, categoryMap });
  } catch (error) {
    console.error('Failed to load validation bootstrap data:', error);
    return NextResponse.json({ error: 'Could not load validation data.' }, { status: 502 });
  }
}