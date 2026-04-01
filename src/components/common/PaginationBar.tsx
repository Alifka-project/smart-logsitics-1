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
 * Compact, balanced pagination footer used across all data tables.
 * Desktop: single tight row — count on left, buttons on right.
 * Mobile: stacks vertically, both centred.
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

  const half = 2;
  let start  = Math.max(1, page - half);
  let end    = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  /* ── shared button styles ── */
  const btn  = 'inline-flex items-center justify-center h-7 min-w-[28px] px-2 rounded text-xs font-medium border transition-colors select-none';
  const off  = 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700';
  const on   = 'border-blue-600 bg-blue-600 text-white';
  const dis  = 'disabled:opacity-35 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
      {/* count */}
      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center sm:text-left shrink-0 leading-none">
        Showing <span className="font-medium text-gray-600 dark:text-gray-300">{from}–{to}</span> of <span className="font-medium text-gray-600 dark:text-gray-300">{total}</span>
      </p>

      {/* buttons */}
      <div className="flex items-center justify-center sm:justify-end gap-1 flex-wrap">
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className={`${btn} ${off} ${dis} px-2.5`}>
          ← Prev
        </button>

        {start > 1 && (
          <>
            <button onClick={() => onPageChange(1)} className={`${btn} ${off}`}>1</button>
            {start > 2 && <span className="text-[11px] text-gray-400 px-0.5 select-none">…</span>}
          </>
        )}

        {nums.map(n => (
          <button key={n} onClick={() => onPageChange(n)}
            className={`${btn} ${n === page ? on : off}`}>
            {n}
          </button>
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="text-[11px] text-gray-400 px-0.5 select-none">…</span>}
            <button onClick={() => onPageChange(totalPages)} className={`${btn} ${off}`}>{totalPages}</button>
          </>
        )}

        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className={`${btn} ${off} ${dis} px-2.5`}>
          Next →
        </button>
      </div>
    </div>
  );
}
