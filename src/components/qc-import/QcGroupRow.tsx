'use client';

import { useState, Fragment } from 'react';
import { CheckCircle, XCircle, Trash2, AlertCircle, ChevronDown, Wand2, Users } from 'lucide-react';
import { useQcImportStore } from '@/store/useQcImportStore';
import { getFieldOptions } from '@/lib/shared/excelTemplate';
import { ConfidenceBadge } from './ConfidenceBadge';
import type { GroupedModelRow } from '@/lib/qc-extract/types';

const COLUMNS: { label: string; key: string }[] = [
  { label: 'Brand', key: 'make' },
  { label: 'Category', key: 'product_name' },
  { label: 'Sub Category', key: 'sub_producd' },
  { label: 'Model', key: 'model' },
  { label: 'RAM', key: 'ram_cap' },
  { label: 'HDD', key: 'strg1' },
  { label: 'SSD', key: 'strg2' },
  { label: 'CPU Core', key: 'cpu_core' },
  { label: 'CPU Gen', key: 'cpu_gen' },
  { label: 'CPU Speed', key: 'cpu_speed' },
  { label: 'Color', key: 'color' },
  { label: 'GPU Type', key: 'gpu_type' },
  { label: 'GPU Capacity', key: 'gpu_cap' },
  { label: 'Display Size', key: 'display_size' },
];

function QcFieldCell({ group, fieldKey }: { group: GroupedModelRow; fieldKey: string }) {
  const updateGroupField = useQcImportStore((s) => s.updateGroupField);
  const addPendingCorrection = useQcImportStore((s) => s.addPendingCorrection);
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [search, setSearch] = useState('');

  const value = group.original?.[fieldKey] || '';
  const error = group.errors?.[fieldKey];
  const tier = group.fieldTiers?.[fieldKey];

  const openPicker = async () => {
    setShowPicker((v) => !v);
    if (options === null && !loadingOptions) {
      setLoadingOptions(true);
      try {
        setOptions(await getFieldOptions(fieldKey, group.original));
      } finally {
        setLoadingOptions(false);
      }
    }
  };

  const closePicker = () => {
    setShowPicker(false);
    setSearch('');
  };

  const filteredOptions = options?.filter((o) => o.toLowerCase().includes(search.toLowerCase())) ?? null;

  return (
    <td className="px-4 py-3 align-top min-w-[160px]">
      <div className="flex flex-col gap-1">
        {tier && <ConfidenceBadge tier={tier} />}

        <span className={error ? 'text-red-600 text-xs' : 'text-xs text-gray-700'}>
          {value || <span className="italic text-gray-400">empty</span>}
        </span>

        {error && (
          <div className="flex items-center gap-1 text-[11px] text-red-500 max-w-xs" title={error.message}>
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{error.message}</span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-1">
          {error?.suggestion && (
            <button
              onClick={() => updateGroupField(group.id, fieldKey, error.suggestion!)}
              className="flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-0.5 transition-colors"
              title={`Replace with "${error.suggestion}"`}
            >
              <Wand2 className="w-3 h-3" />
              Use &quot;{error.suggestion}&quot;
            </button>
          )}

          <div className="relative">
            <button
              onClick={openPicker}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded px-2 py-0.5 transition-colors"
            >
              Pick <ChevronDown className="w-3 h-3" />
            </button>

            {showPicker && (
              <div className="absolute z-30 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg w-64 max-h-72 flex flex-col">
                <div className="p-2 border-b border-gray-100">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search options…"
                    autoFocus
                    className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-orange-400"
                  />
                </div>
                <div className="overflow-y-auto">
                  {loadingOptions && <div className="px-3 py-2 text-xs text-gray-400">Loading options…</div>}
                  {!loadingOptions && options !== null && options.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      No options available — either this list depends on Brand being resolved first, or the CRM has no entries for it yet.
                    </div>
                  )}
                  {!loadingOptions && options !== null && options.length > 0 && filteredOptions?.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">No matches for &quot;{search}&quot;.</div>
                  )}
                  {!loadingOptions &&
                    filteredOptions?.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          if (error) {
                            const scope = fieldKey === 'model' ? group.original.make || '' : 'global';
                            addPendingCorrection({ field: fieldKey, scope, rawValue: value, correctValue: opt });
                          }
                          updateGroupField(group.id, fieldKey, opt);
                          closePicker();
                        }}
                        className="block w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 text-gray-700"
                      >
                        {opt}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

export function QcGroupRow({ group }: { group: GroupedModelRow }) {
  const removeGroup = useQcImportStore((s) => s.removeGroup);
  const [showSerials, setShowSerials] = useState(false);

  return (
    <tr className={`border-b hover:bg-gray-50 transition-colors align-top ${!group.isValid ? 'bg-red-50/30' : ''}`}>
      <td className="px-4 py-3 sticky left-0 bg-white z-10">
        {group.isValid ? (
          <CheckCircle className="w-5 h-5 text-green-500" />
        ) : (
          <XCircle className="w-5 h-5 text-red-500" />
        )}
      </td>

      <td className="px-4 py-3 sticky left-[52px] bg-white z-10">
        <div className="relative">
          <button
            onClick={() => setShowSerials((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded px-2 py-1"
            title="View serial numbers in this batch"
          >
            <Users className="w-3 h-3" />
            {group.unitCount}
          </button>
          {showSerials && (
            <div className="absolute z-30 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg w-56 max-h-56 overflow-y-auto p-2">
              <p className="text-[10px] text-gray-400 mb-1">Serial numbers ({group.unitCount})</p>
              {group.serialNumbers.map((sn) => (
                <div key={sn} className="text-[11px] text-gray-700 font-mono py-0.5">
                  {sn}
                </div>
              ))}
            </div>
          )}
        </div>
      </td>

      {COLUMNS.map((col) => (
        <Fragment key={col.key}>
          <QcFieldCell group={group} fieldKey={col.key} />
          {col.key === 'cpu_core' && (
            <td className="px-4 py-3 text-xs text-gray-700">
              {group.cpuSeries || <span className="italic text-gray-400">—</span>}
            </td>
          )}
        </Fragment>
      ))}

      <td className="px-4 py-3 text-right sticky right-0 bg-white z-10">
        <button
          onClick={() => removeGroup(group.id)}
          className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </td>
    </tr>
  );
}

export { COLUMNS as QC_REVIEW_COLUMNS };