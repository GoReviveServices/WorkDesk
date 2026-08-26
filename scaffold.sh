#!/usr/bin/env bash
set -e

# Run from your project root (e.g. where package.json will live)

mkdir -p \
  "app/api/auth/login" \
  "app/api/auth/logout" \
  "app/api/master-data" \
  "app/api/field-options" \
  "app/api/models/search" \
  "app/api/models/submit" \
  "app/(app)/bulk-upload" \
  "app/(app)/qc-import" \
  "lib/server" \
  "lib/shared" \
  "lib/qc-extract/__fixtures__" \
  "lib/qc-extract/__tests__" \
  "components/bulk-upload" \
  "components/qc-import" \
  "store"

touch \
  "app/api/auth/login/route.ts" \
  "app/api/auth/logout/route.ts" \
  "app/api/master-data/route.ts" \
  "app/api/field-options/route.ts" \
  "app/api/models/search/route.ts" \
  "app/api/models/submit/route.ts" \
  "app/(app)/bulk-upload/page.tsx" \
  "app/(app)/qc-import/page.tsx" \
  "app/layout.tsx" \
  "app/page.tsx" \
  "lib/server/legacyClient.ts" \
  "lib/server/htmlParsers.ts" \
  "lib/server/masterDataCache.ts" \
  "lib/shared/validation.ts" \
  "lib/shared/matching.ts" \
  "lib/shared/excelTemplate.ts" \
  "lib/qc-extract/brand.ts" \
  "lib/qc-extract/model.ts" \
  "lib/qc-extract/cpu.ts" \
  "lib/qc-extract/gpu.ts" \
  "lib/qc-extract/storage.ts" \
  "lib/qc-extract/grouping.ts" \
  "lib/qc-extract/types.ts" \
  "components/qc-import/QcUploader.tsx" \
  "components/qc-import/QcReviewTable.tsx" \
  "components/qc-import/QcGroupRow.tsx" \
  "components/qc-import/BulkFillBar.tsx" \
  "components/qc-import/ConfidenceBadge.tsx" \
  "store/useBulkUploadStore.ts" \
  "store/useQcImportStore.ts"

echo "Scaffold created."
