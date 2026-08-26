'use client';

import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';

export function SyncCategoryMapButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setLastResult(null);
    try {
      const response = await fetch('/api/category-map/sync', { method: 'POST' });
      const result = await response.json();
      if (result.ok) {
        setLastResult(
          `Synced ${result.categoriesFound} categories / ${result.subCategoriesFound} sub-categories (${result.brandsScanned} brands scanned)`
        );
      } else {
        setLastResult(`Failed: ${result.error}`);
      }
    } catch (error) {
      setLastResult(error instanceof Error ? `Failed: ${error.message}` : 'Failed: unknown error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={isSyncing}
        title="Crawl the CRM's brand/category/sub-category hierarchy into MongoDB. This can take a while — one request per brand and per unique category."
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-50 transition-colors"
      >
        {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Sync Category Map
      </button>
      {lastResult && (
        <div className="absolute right-0 mt-1 text-[11px] text-gray-500 bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 w-64 z-30">
          {lastResult}
        </div>
      )}
    </div>
  );
}