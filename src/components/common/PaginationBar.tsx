import React from 'react';

interface PaginationBarProps {
  /** 1-indexed current page */
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * Standardised pagination footer used across all data tables.
 * - Mobile: stacks vertically (count on top, buttons below, both centred)
 * - Tablet+: horizontal row with count on left, buttons on right
 * - Shows up to 5 numbered page buttons with … ellipsis and first/last jumps
 */
export default function PaginationBar({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
}: PaginationBarProps): React.ReactElement | null {
  if (totalPages <= 1) return null;

  const from = Math.min((page - 1) * pageSize + 1, total);
  const to   = Math.min(page * pageSize, total);

  const half  = 2;
  let start   = Math.max(1, page - half);
  let end     = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  const base     = 'min-w-[36px] px-3 py-1.5 rounded-lg text-sm border transition-colors';
  const inactive = 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800';
  const active   = 'bg-blue-600 border-blue-600 text-white font-semibold';
  const disabled = 'disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left shrink-0">
        Showing {from}–{to} of {total}
      </p>

      <div className="flex items-center justify-center sm:justify-end flex-wrap gap-1.5">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={`${base} ${inactive} ${disabled}`}
        >
          ← Prev
        </button>

        {start > 1 && (
          <>
            <button onClick={() => onPageChange(1)} className={`${base} ${inactive}`}>1</button>
            {start > 2 && <span className="px-0.5 text-gray-400 text-sm select-none">…</span>}
          </>
        )}

        {nums.map(n => (
          <button
            key={n}
            onClick={() => onPageChange(n)}
            className={`${base} ${n === page ? active : inactive}`}
          >
            {n}
          </button>
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="px-0.5 text-gray-400 text-sm select-none">…</span>}
            <button onClick={() => onPageChange(totalPages)} className={`${base} ${inactive}`}>{totalPages}</button>
          </>
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className={`${base} ${inactive} ${disabled}`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
