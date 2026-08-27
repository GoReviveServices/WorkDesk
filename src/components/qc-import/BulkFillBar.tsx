'use client';

import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { useQcImportStore } from '@/store/useQcImportStore';

// color is the documented batch-default target — a field with no source
// column in the QC report at all, so a per-batch operator-set default is
// the intended fix, not per-row entry. HSN Code deliberately isn't here:
// QC Import never submits to the CRM, so HSN is out of scope entirely —
// it gets filled in later, during Bulk Upload.
const BULK_FILL_FIELDS: { label: string; key: string }[] = [{ label: 'Color', key: 'color' }];

export function BulkFillBar() {
  const groups = useQcImportStore((s) => s.groups);
  const bulkFillField = useQcImportStore((s) => s.bulkFillField);

  const [field, setField] = useState(BULK_FILL_FIELDS[0].key);
  const [value, setValue] = useState('');
  const [isApplying, setIsApplying] = useState(false);

  if (groups.length === 0) return null;

  const targetGroupIds = groups.filter((g) => !g.original[field]).map((g) => g.id);

  const handleApply = async () => {
    if (!value.trim() || targetGroupIds.length === 0) return;
    setIsApplying(true);
    try {
      await bulkFillField(field, value.trim(), targetGroupIds);
      setValue('');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold text-amber-800 flex items-center gap-1">
        <Wand2 className="w-3.5 h-3.5" />
        Batch fill:
      </span>

      <select
        value={field}
        onChange={(e) => setField(e.target.value)}
        disabled={isApplying}
        className="text-sm border border-amber-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-amber-400"
      >
        {BULK_FILL_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Value to apply"
        disabled={isApplying}
        className="text-sm border border-amber-300 rounded-lg px-3 py-1.5 flex-1 min-w-[160px] outline-none focus:ring-2 focus:ring-amber-400"
      />

      <button
        onClick={handleApply}
        disabled={isApplying || !value.trim() || targetGroupIds.length === 0}
        className="flex items-center gap-1.5 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 rounded-lg px-4 py-1.5 transition-colors"
      >
        {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        Apply to {targetGroupIds.length} row{targetGroupIds.length === 1 ? '' : 's'} missing it
      </button>
    </div>
  );
}