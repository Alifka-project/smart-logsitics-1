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
        className="relative inline-flex cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/60 rounded-sm"
        onClick={() => setShow((prev) => !prev)}
      >
        <HelpCircle className="w-3.5 h-3.5" />
        {show && (
          <span
            role="tooltip"
            className="absolute z-50 left-0 bottom-full mb-1 px-2 py-1.5 text-xs font-normal text-gray-100 bg-gray-800 dark:bg-gray-900 rounded shadow-lg whitespace-normal max-w-[220px]"
          >
            {definition}
          </span>
        )}
      </button>
    </span>
  );
}
