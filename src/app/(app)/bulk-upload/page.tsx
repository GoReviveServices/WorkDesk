'use client';

import { DataTable } from '@/components/bulk-upload/DataTable';
import { Uploader } from '@/components/bulk-upload/Uploader';
import { useBulkUploadStore } from '@/store/useBulkUploadStore';

export default function BulkUploadPage() {
  const setRows = useBulkUploadStore((s) => s.setRows);

  return (
    <>
      <Uploader onDataParsed={(rows) => setRows(rows)} />
      <DataTable />
    </>
  );
}