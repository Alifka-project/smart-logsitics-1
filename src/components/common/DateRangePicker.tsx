import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DateRangePickerProps {
  from: string;   // YYYY-MM-DD or ''
  to: string;     // YYYY-MM-DD or ''
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Portal-positioned popover: compute viewport coordinates so it escapes any
  // overflow-hidden parents (which was clipping the calendar in Logistics portal).
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Calendar display state — month/year
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth()); // 0-based

  // Selection phase: 'start' = waiting for first click, 'end' = waiting for second click
  const [phase, setPhase] = useState<'start' | 'end'>('start');

  // Close on outside click (must ignore clicks inside the portalled popover too)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Compute popover position relative to the viewport; re-position on scroll/resize.
  useEffect(() => {
    if (!open) { setPopoverPos(null); return; }
    const place = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const popupWidth = 288; // w-72
      const margin = 8;
      const spaceRight = window.innerWidth - rect.left;
      const left = spaceRight < popupWidth + margin
        ? Math.max(margin, rect.right - popupWidth)
        : rect.left;
      setPopoverPos({ top: rect.bottom + 4, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Reset phase when popover opens
  useEffect(() => {
    if (open) setPhase(from && !to ? 'end' : 'start');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevMonth = useCallback(() => {
    setCalMonth(m => { if (m === 0) { setCalYear(y => y - 1); return 11; } return m - 1; });
  }, []);
  const nextMonth = useCallback(() => {
    setCalMonth(m => { if (m === 11) { setCalYear(y => y + 1); return 0; } return m + 1; });
  }, []);

  // Build grid: blank cells for days before the 1st, then all days
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow = new Date(calYear, calMonth, 1).getDay(); // 0=Sun

  const toIso = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const handleDayClick = (iso: string) => {
    if (phase === 'start') {
      onChange(iso, '');
      setPhase('end');
    } else {
      if (iso < from) {
        onChange(iso, from);
      } else {
        onChange(from, iso);
      }
      setPhase('start');
      setOpen(false);
    }
  };

  const effectiveEnd = phase === 'end' && hoverDate ? hoverDate : to;

  const rangeStart = from && effectiveEnd ? (from <= effectiveEnd ? from : effectiveEnd) : from;
  const rangeEnd   = from && effectiveEnd ? (from <= effectiveEnd ? effectiveEnd : from) : effectiveEnd;

  const isStart   = (iso: string) => iso === from;
  const isEnd     = (iso: string) => iso === to;
  const isInRange = (iso: string) => !!rangeStart && !!rangeEnd && iso > rangeStart && iso < rangeEnd;
  const isRangeEdge = (iso: string) => iso === rangeStart || iso === rangeEnd;

  // Label for the trigger button
  const fmtLabel = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const triggerLabel = from && to
    ? `${fmtLabel(from)} – ${fmtLabel(to)}`
    : from
    ? `From ${fmtLabel(from)}`
    : 'Date range';

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const DOW = ['S','M','T','W','T','F','S'];

  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#032145] ${
          from || to
            ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
            : 'border-gray-200 dark:border-gray-500 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-400'
        }`}
        aria-label="Open date range picker"
      >
        <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="max-w-[180px] truncate">{triggerLabel}</span>
        {(from || to) && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange('', ''); setPhase('start'); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onChange('', ''), setPhase('start'))}
            className="ml-0.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 rounded"
            aria-label="Clear date range"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {/* Calendar popover — portalled so it escapes overflow:hidden parents */}
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] w-72 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl p-4 select-none"
          style={{ top: popoverPos.top, left: popoverPos.left, minWidth: 280 }}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth}
              className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {MONTH_NAMES[calMonth]} {calYear}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Hint text */}
          <p className="text-[10px] text-center text-gray-400 dark:text-gray-500 mb-2">
            {phase === 'start' ? 'Click a start date' : 'Click an end date'}
          </p>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DOW.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold text-gray-400 dark:text-gray-500 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const iso = toIso(calYear, calMonth, day);
              const selected = isStart(iso) || isEnd(iso);
              const inRange = isInRange(iso);
              const edge = isRangeEdge(iso);

              return (
                <div
                  key={day}
                  onClick={() => handleDayClick(iso)}
                  onMouseEnter={() => phase === 'end' && setHoverDate(iso)}
                  onMouseLeave={() => setHoverDate(null)}
                  className={`
                    relative flex items-center justify-center h-8 text-xs font-medium cursor-pointer transition-colors
                    ${selected
                      ? 'text-white z-10'
                      : inRange
                      ? 'text-blue-800 dark:text-blue-200'
                      : 'text-gray-700 dark:text-gray-200 hover:text-[#032145] dark:hover:text-blue-300'}
                    ${inRange && !edge ? 'bg-blue-100 dark:bg-blue-900/40' : ''}
                    ${isStart(iso) && to ? 'rounded-l-full' : ''}
                    ${isEnd(iso) && from ? 'rounded-r-full' : ''}
                    ${!from && !to ? 'hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full' : ''}
                  `}
                >
                  {(selected || (edge && from && effectiveEnd)) && (
                    <span className="absolute inset-[2px] rounded-full bg-[#032145] dark:bg-blue-600 z-0" />
                  )}
                  {!selected && !inRange && !edge && (
                    <span className="absolute inset-[2px] rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 z-0" />
                  )}
                  <span className="relative z-10">{day}</span>
                </div>
              );
            })}
          </div>

          {/* Footer: quick presets */}
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-1.5">
            {[
              { label: 'Today', fn: () => { const t = toIso(today.getFullYear(), today.getMonth(), today.getDate()); onChange(t, t); setOpen(false); } },
              { label: 'This week', fn: () => {
                const d = new Date(); d.setDate(d.getDate() - d.getDay());
                const s = toIso(d.getFullYear(), d.getMonth(), d.getDate());
                d.setDate(d.getDate() + 6);
                const e = toIso(d.getFullYear(), d.getMonth(), d.getDate());
                onChange(s, e); setOpen(false);
              }},
              { label: 'This month', fn: () => {
                const s = toIso(today.getFullYear(), today.getMonth(), 1);
                const e = toIso(today.getFullYear(), today.getMonth(), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
                onChange(s, e); setOpen(false);
              }},
              { label: 'Clear', fn: () => { onChange('', ''); setPhase('start'); setOpen(false); } },
            ].map(({ label, fn }) => (
              <button
                key={label}
                type="button"
                onClick={fn}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  label === 'Clear'
                    ? 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800'
                    : 'text-[#032145] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
