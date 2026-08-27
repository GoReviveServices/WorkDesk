import { QcUploader } from '@/components/qc-import/QcUploader';
import { BulkFillBar } from '@/components/qc-import/BulkFillBar';
import { QcReviewTable } from '@/components/qc-import/QcReviewTable';

export default function QcImportPage() {
  return (
    <>
      <QcUploader />
      <BulkFillBar />
      <QcReviewTable />
    </>
  );
}