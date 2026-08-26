import type { ConfidenceTier } from '@/lib/qc-extract/types';

const TIER_STYLES: Record<ConfidenceTier, { label: string; className: string }> = {
  matched: { label: 'Matched', className: 'bg-green-50 text-green-700 border-green-200' },
  suggested: { label: 'Suggested', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  needs_review: { label: 'Needs review', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing: { label: 'Missing', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
  const { label, className } = TIER_STYLES[tier];
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border ${className}`}>
      {label}
    </span>
  );
}
