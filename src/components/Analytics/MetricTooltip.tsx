import React from 'react';
import { HelpCircle } from 'lucide-react';

interface MetricTooltipProps {
  term: string;
  definition: string;
  className?: string;
}

export default function MetricTooltip({ term, definition, className = '' }: MetricTooltipProps): React.ReactElement {
  const [show, setShow] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!show) return;

    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      if (!triggerRef.current) return;
      const target = event.target as Node | null;
      if (target && !triggerRef.current.contains(target)) {
        setShow(false);
      }
    };

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setShow(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [show]);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{term}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Explain ${term}`}
        aria-expanded={show}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-md bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:bg-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        onClick={() => setShow((prev) => !prev)}
      >
        <HelpCircle className="w-4 h-4" />
        {show && (
          <span
            role="tooltip"
            className="absolute z-50 left-1/2 bottom-full mb-2 -translate-x-1/2 rounded-xl border border-slate-700/70 bg-slate-900 px-3 py-2.5 text-left text-sm font-normal leading-5 text-slate-100 shadow-2xl whitespace-normal w-[min(320px,calc(100vw-2rem))]"
          >
            {definition}
          </span>
        )}
      </button>
    </span>
  );
}
