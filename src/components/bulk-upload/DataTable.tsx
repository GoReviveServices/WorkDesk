'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Trash2, UploadCloud, AlertCircle, ChevronDown, Wand2, Download, GraduationCap } from 'lucide-react';
import { useBulkUploadStore } from '@/store/useBulkUploadStore';
import { COLUMN_MAPPING, getFieldOptions, downloadResults, downloadProcessedData } from '@/lib/shared/excelTemplate';
import type { ValidatedRow } from '@/lib/shared/validation';

const COLUMNS = Object.entries(COLUMN_MAPPING).map(([label, key]) => ({ label, key }));

// ---------------------------------------------------------------------------
// One cell. Always shows a searchable "Pick from list" so a value can be
// overridden even when it looks valid — not just when there's an error —
// since a value can be wrong without ever triggering the fuzzy-suggestion
// threshold (e.g. a genuinely different model that just happens to parse
// cleanly). When there IS an error, also shows the message and a one-click
// "Use '<suggestion>'" button when we have a close match.
// ---------------------------------------------------------------------------
function FieldCell({ row, fieldKey }: { row: ValidatedRow; fieldKey: string }) {
  const updateRowField = useBulkUploadStore((s) => s.updateRowField);
  const addPendingCorrection = useBulkUploadStore((s) => s.addPendingCorrection);
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState<string[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [search, setSearch] = useState('');

  const value = row.original?.[fieldKey] || '';
  const error = row.errors?.[fieldKey];

  const openPicker = async () => {
    setShowPicker((v) => !v);
    if (options === null && !loadingOptions) {
      setLoadingOptions(true);
      try {
        const opts = await getFieldOptions(fieldKey, row.original);
        setOptions(opts);
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
    <td className="px-4 py-3 align-top min-w-[180px]">
      <div className="flex flex-col gap-1">
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
              onClick={() => updateRowField(row.id, fieldKey, error.suggestion!)}
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
                      No options available — fix a field this one depends on first (e.g. Brand).
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
                          // Layer 3 of the verification flow: a manual
                          // Pick on a field that had no automatic match
                          // is a human confirming "this raw text really
                          // does mean this value". Held here, not
                          // written to the learned-corrections DB yet —
                          // that only happens on actual upload (see
                          // submitValidRows), so an exploratory pick
                          // that's later changed never gets learned.
                          if (error) {
                            const scope = fieldKey === 'model' ? row.original.make || '' : 'global';
                            addPendingCorrection({ field: fieldKey, scope, rawValue: value, correctValue: opt });
                          }
                          updateRowField(row.id, fieldKey, opt);
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

export function DataTable() {
  const { rows, results, isUploading, uploadProgress, pendingCorrections, removeRow, clearRows, submitValidRows, verifyAndLearn } =
    useBulkUploadStore();
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [isLearning, setIsLearning] = useState(false);

  const handleVerifyAndLearn = async () => {
    setIsLearning(true);
    setLearnMessage(null);
    try {
      const { exactLearned, patternsActivated, patternsBuildingEvidence } = await verifyAndLearn();
      if (exactLearned === 0 && patternsActivated === 0 && patternsBuildingEvidence === 0) {
        setLearnMessage('No pending corrections to learn from.');
      } else {
        const parts: string[] = [];
        if (exactLearned > 0) parts.push(`${exactLearned} exact value${exactLearned === 1 ? '' : 's'} remembered`);
        if (patternsActivated > 0) parts.push(`${patternsActivated} pattern${patternsActivated === 1 ? '' : 's'} now active`);
        if (patternsBuildingEvidence > 0) parts.push(`${patternsBuildingEvidence} pattern${patternsBuildingEvidence === 1 ? '' : 's'} still building evidence`);
        setLearnMessage(`${parts.join('. ')}. No CRM records created.`);
      }
    } finally {
      setIsLearning(false);
    }
  };

  if (rows.length === 0) return null;

  const validCount = rows.filter((r) => r.isValid).length;
  const invalidCount = rows.length - validCount;
  const hasResults = Object.keys(results).length > 0;

  const progressPercentage =
    uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0;

  return (
    <div className="w-full max-w-7xl mx-auto mt-8 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex gap-4">
          <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Total: {rows.length}
          </div>
          <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Ready: {validCount}
          </div>
          <div className="bg-red-100 text-red-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Errors: {invalidCount}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={clearRows}
            disabled={isUploading}
            className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Clear All
          </button>
          {rows.length > 0 && (
            <button
              onClick={() => downloadProcessedData(rows)}
              disabled={isUploading}
              title="Download the current sheet as-is, any time — valid, invalid, or mid-review"
              className="flex items-center px-4 py-2 text-sm font-bold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <Download className="w-4 h-4 mr-2 text-blue-500" />
              Download Current Sheet
            </button>
          )}
          {hasResults && (
            <button
              onClick={() => downloadResults(rows, results)}
              className="flex items-center px-4 py-2 text-sm font-bold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="w-4 h-4 mr-2 text-orange-500" />
              Download Results
            </button>
          )}
          {pendingCorrections.length > 0 && (
            <div className="relative">
              <button
                onClick={handleVerifyAndLearn}
                disabled={isLearning || isUploading}
                title="Remembers your Picked corrections for next time, without creating any CRM records"
                className="flex items-center px-4 py-2 text-sm font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50 transition-colors"
              >
                <GraduationCap className="w-4 h-4 mr-2" />
                Verify &amp; Learn ({pendingCorrections.length}) — No Submit
              </button>
              {learnMessage && (
                <div className="absolute right-0 mt-1 text-[11px] text-gray-500 bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 w-56 z-30">
                  {learnMessage}
                </div>
              )}
            </div>
          )}
          <button
            onClick={submitValidRows}
            disabled={isUploading || validCount === 0}
            className="flex items-center px-6 py-2 text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50 transition-all shadow-md"
          >
            <UploadCloud className="w-4 h-4 mr-2" />
            Upload {validCount} Valid Models
          </button>
        </div>
      </div>

      {(isUploading || uploadProgress.total > 0) && (
        <div className="px-6 py-4 bg-orange-50 border-b border-orange-100">
          <div className="flex justify-between text-sm font-semibold text-orange-800 mb-2">
            <span>
              Uploading... {uploadProgress.current} / {uploadProgress.total}
            </span>
            <span>{progressPercentage}%</span>
          </div>
          <div className="w-full bg-orange-200 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-orange-500 h-2.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          <div className="flex gap-4 mt-2 text-xs font-medium text-gray-600">
            <span className="text-green-600">Successful: {uploadProgress.success}</span>
            <span className="text-red-600">Failed: {uploadProgress.failed}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm text-left text-gray-500 whitespace-nowrap">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 sticky left-0 bg-gray-50 z-20">Status</th>
              <th className="px-4 py-3 sticky left-[52px] bg-gray-50 z-20">Row #</th>
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-4 py-3">
                  {col.label}
                </th>
              ))}
              {hasResults && <th className="px-4 py-3">Model Code</th>}
              <th className="px-4 py-3 text-right sticky right-0 bg-gray-50 z-20">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b hover:bg-gray-50 transition-colors align-top ${!row.isValid ? 'bg-red-50/30' : ''}`}
              >
                <td className="px-4 py-3 sticky left-0 bg-white z-10">
                  {row.isValid ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                </td>
                <td className="px-4 py-3 font-semibold text-gray-900 sticky left-[52px] bg-white z-10">
                  {row.rowIndex}
                </td>

                {COLUMNS.map((col) => (
                  <FieldCell key={col.key} row={row} fieldKey={col.key} />
                ))}

                {hasResults && (
                  <td className="px-4 py-3">
                    {results[row.id] ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`text-xs font-semibold ${
                            results[row.id].status === 'success'
                              ? 'text-green-700'
                              : results[row.id].status === 'ambiguous'
                                ? 'text-amber-600'
                                : 'text-red-600'
                          }`}
                        >
                          {results[row.id].modelCode || '—'}
                        </span>
                        <span
                          className="text-[11px] text-gray-400 max-w-[160px] truncate"
                          title={results[row.id].message}
                        >
                          {results[row.id].message}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                )}

                <td className="px-4 py-3 text-right sticky right-0 bg-white z-10">
                  <button
                    onClick={() => removeRow(row.id)}
                    disabled={isUploading}
                    className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 p-1 rounded-md hover:bg-red-50"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}