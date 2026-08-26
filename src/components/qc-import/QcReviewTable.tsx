'use client';

import { useState } from 'react';
import { UploadCloud, Download, GraduationCap } from 'lucide-react';
import { Fragment } from 'react';
import { useQcImportStore } from '@/store/useQcImportStore';
import { downloadResults, downloadProcessedData } from '@/lib/shared/excelTemplate';
import { QcGroupRow, QC_REVIEW_COLUMNS } from './QcGroupRow';

export function QcReviewTable() {
  const { groups, results, isUploading, uploadProgress, pendingCorrections, clearGroups, submitValidGroups, verifyAndLearn } =
    useQcImportStore();
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
        if (patternsActivated > 0) parts.push(`${patternsActivated} pattern${patternsActivated === 1 ? '' : 's'} now active — will auto-apply to future rows`);
        if (patternsBuildingEvidence > 0) parts.push(`${patternsBuildingEvidence} pattern${patternsBuildingEvidence === 1 ? '' : 's'} still building evidence`);
        setLearnMessage(`${parts.join('. ')}. No CRM records created.`);
      }
    } finally {
      setIsLearning(false);
    }
  };

  if (groups.length === 0) return null;

  const validCount = groups.filter((g) => g.isValid).length;
  const invalidCount = groups.length - validCount;
  const totalUnits = groups.reduce((sum, g) => sum + g.unitCount, 0);
  const hasResults = Object.keys(results).length > 0;

  // Cell-level count: one cell per (group, submitted field) — different
  // from Ready/Needs input, which counts whole GROUPS.
  const totalCells = groups.length * QC_REVIEW_COLUMNS.length;
  const unmatchedCells = groups.reduce((sum, g) => sum + Object.keys(g.errors).length, 0);
  const matchedCells = totalCells - unmatchedCells;
  const matchedPct = totalCells > 0 ? Math.round((matchedCells / totalCells) * 100) : 0;
  const readyPct = groups.length > 0 ? Math.round((validCount / groups.length) * 100) : 0;

  const progressPercentage =
    uploadProgress.total > 0 ? Math.round((uploadProgress.current / uploadProgress.total) * 100) : 0;

  return (
    <div className="w-full max-w-7xl mx-auto mt-4 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex flex-wrap gap-4">
          <div className="bg-purple-100 text-purple-800 px-4 py-2 rounded-lg text-sm font-semibold">
            {totalUnits} units → {groups.length} groups
          </div>
          <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Ready: {validCount} ({readyPct}%)
          </div>
          <div className="bg-red-100 text-red-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Needs input: {invalidCount}
          </div>
          <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg text-sm font-semibold">
            Cells: {totalCells} → Matched: {matchedCells} ({matchedPct}%) / Not matched: {unmatchedCells}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={clearGroups}
            disabled={isUploading}
            className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Clear All
          </button>
          {groups.length > 0 && (
            <button
              onClick={() => downloadProcessedData(groups)}
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
              onClick={() => downloadResults(groups, results)}
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
                title="Remembers your Picked corrections for next time, without creating any CRM records — safe to use before you're ready to actually upload"
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
            onClick={submitValidGroups}
            disabled={isUploading || validCount === 0}
            className="flex items-center px-6 py-2 text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50 transition-all shadow-md"
          >
            <UploadCloud className="w-4 h-4 mr-2" />
            Upload {validCount} Valid Groups
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
              <th className="px-4 py-3 sticky left-[52px] bg-gray-50 z-20">Units</th>
              {QC_REVIEW_COLUMNS.map((col) => (
                <Fragment key={col.key}>
                  <th className="px-4 py-3">{col.label}</th>
                  {col.key === 'cpu_core' && <th className="px-4 py-3">CPU Series</th>}
                </Fragment>
              ))}
              {hasResults && <th className="px-4 py-3">Model Code</th>}
              <th className="px-4 py-3 text-right sticky right-0 bg-gray-50 z-20">Action</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <QcGroupRow key={group.id} group={group} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}