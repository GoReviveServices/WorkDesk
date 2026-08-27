'use client';

import { useState, useMemo, Fragment } from 'react';
import { Download, GraduationCap, RefreshCw, Undo2 } from 'lucide-react';
import { useQcImportStore } from '@/store/useQcImportStore';
import { downloadProcessedData, resetMasterDataCache, resetBrandCache } from '@/lib/shared/excelTemplate';
import { QcGroupRow, QC_REVIEW_COLUMNS } from './QcGroupRow';

export function QcReviewTable() {
  const { groups, pendingCorrections, lastBulkFill, clearGroups, verifyAndLearn, undoLastBulkFill, revalidateGroups } =
    useQcImportStore();
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [isLearning, setIsLearning] = useState(false);
  const [isReloadingGeneral, setIsReloadingGeneral] = useState(false);
  const [isReloadingBrand, setIsReloadingBrand] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState('');

  // Distinct resolved brands currently in view — id is what the CRM
  // actually keys options by, label is what the operator recognizes.
  const brandOptions = useMemo(() => {
    const seen = new Map<string, string>();
    groups.forEach((g) => {
      const id = g.data?.make;
      const label = g.original.make;
      if (id && label && !seen.has(id)) seen.set(id, label);
    });
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [groups]);

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
        setLearnMessage(parts.join('. ') + '.');
      }
    } finally {
      setIsLearning(false);
    }
  };

  const handleReloadGeneral = async () => {
    setIsReloadingGeneral(true);
    try {
      await resetMasterDataCache();
      await revalidateGroups();
    } finally {
      setIsReloadingGeneral(false);
    }
  };

  const handleReloadBrand = async () => {
    if (!selectedBrandId) return;
    setIsReloadingBrand(true);
    try {
      await resetBrandCache(selectedBrandId);
      await revalidateGroups();
    } finally {
      setIsReloadingBrand(false);
    }
  };

  if (groups.length === 0) return null;

  const validCount = groups.filter((g) => g.isValid).length;
  const invalidCount = groups.length - validCount;
  const totalUnits = groups.reduce((sum, g) => sum + g.unitCount, 0);

  // Cell-level count: one cell per (group, field) — different from
  // Ready/Needs input, which counts whole GROUPS.
  const totalCells = groups.length * QC_REVIEW_COLUMNS.length;
  const unmatchedCells = groups.reduce((sum, g) => sum + Object.keys(g.errors).length, 0);
  const matchedCells = totalCells - unmatchedCells;
  const matchedPct = totalCells > 0 ? Math.round((matchedCells / totalCells) * 100) : 0;
  const readyPct = groups.length > 0 ? Math.round((validCount / groups.length) * 100) : 0;

  return (
    <div className="w-full max-w-7xl mx-auto mt-4 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
              className="px-4 py-2 text-sm font-bold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear All
            </button>
            {lastBulkFill && (
              <button
                onClick={undoLastBulkFill}
                title={`Undo the last batch fill (${lastBulkFill.field})`}
                className="flex items-center px-4 py-2 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Undo Batch Fill
              </button>
            )}
            {pendingCorrections.length > 0 && (
              <div className="relative">
                <button
                  onClick={handleVerifyAndLearn}
                  disabled={isLearning}
                  title="Remembers your Picked corrections for next time — never touches the CRM"
                  className="flex items-center px-4 py-2 text-sm font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50 transition-colors"
                >
                  <GraduationCap className="w-4 h-4 mr-2" />
                  Verify &amp; Learn ({pendingCorrections.length})
                </button>
                {learnMessage && (
                  <div className="absolute right-0 mt-1 text-[11px] text-gray-500 bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 w-56 z-30">
                    {learnMessage}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => downloadProcessedData(groups)}
              title="This is the deliverable — hand this sheet to whoever runs Bulk Upload"
              className="flex items-center px-6 py-2 text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-md"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Current Sheet
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            onClick={handleReloadGeneral}
            disabled={isReloadingGeneral}
            title="Refetches brand-independent CRM data (CPU list, GPU list, colors, HSN codes, etc.) without losing your current review"
            className="flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReloadingGeneral ? 'animate-spin' : ''}`} />
            Reload General Data
          </button>

          {brandOptions.length > 0 && (
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1">
              <select
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="text-xs font-semibold text-gray-600 bg-transparent outline-none"
              >
                <option value="">Reload one brand…</option>
                {brandOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleReloadBrand}
                disabled={!selectedBrandId || isReloadingBrand}
                title="Refetches this brand's category/model list without losing your current review"
                className="flex items-center gap-1 font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReloadingBrand ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>
      </div>

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