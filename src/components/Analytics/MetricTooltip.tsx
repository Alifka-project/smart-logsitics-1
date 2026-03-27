import React from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

interface MetricTooltipProps {
  term: string;
  definition: string;
  className?: string;
}

export default function MetricTooltip({ term, definition, className = '' }: MetricTooltipProps): React.ReactElement {
  const [show, setShow] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const openTooltip = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    setPos({
      top: rect.top + scrollY - 8, // above the button, adjusted by tooltip height below
      left: rect.left + scrollX + rect.width / 2,
    });
    setShow(true);
  }, []);

  const closeTooltip = React.useCallback(() => setShow(false), []);

  React.useEffect(() => {
    if (!show) return;

    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (!triggerRef.current) return;
      const target = event.target as Node | null;
      if (target && !triggerRef.current.contains(target)) {
        closeTooltip();
      }
    };

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeTooltip();
    };

    const onScroll = (): void => closeTooltip();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onEscape);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [show, closeTooltip]);

  const tooltipEl =
    show && pos
      ? createPortal(
          <span
            role="tooltip"
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              transform: 'translate(-50%, -100%)',
              zIndex: 99999,
              pointerEvents: 'none',
            }}
            className="rounded-xl border border-slate-700/70 bg-slate-900 px-4 py-3 text-left text-sm font-normal leading-5 text-slate-100 shadow-2xl whitespace-normal w-[min(340px,calc(100vw-2rem))]"
          >
            <span className="block font-semibold text-white mb-1 text-sm">{term}</span>
            <span className="block text-slate-300 text-xs leading-relaxed">{definition}</span>
            {/* Arrow */}
            <span
              style={{
                position: 'absolute',
                bottom: -6,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 12,
                height: 12,
                background: '#0f172a',
                border: '1px solid rgba(148,163,184,0.25)',
                borderTop: 'none',
                borderLeft: 'none',
                rotate: '45deg',
              }}
            />
          </span>,
          document.body,
        )
      : null;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{term}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Explain ${term}`}
        aria-expanded={show}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        onClick={() => (show ? closeTooltip() : openTooltip())}
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {tooltipEl}
    </span>
  );
}
