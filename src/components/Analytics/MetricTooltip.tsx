import React from 'react';
import { HelpCircle } from 'lucide-react';

interface MetricTooltipProps {
  term: string;
  definition: string;
  className?: string;
}

export default function MetricTooltip({ term, definition, className = '' }: MetricTooltipProps): React.ReactElement {
  const [show, setShow] = React.useState(false);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{term}</span>
      <span
        className="relative cursor-help text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <HelpCircle className="w-3.5 h-3.5" />
        {show && (
          <span className="absolute z-50 left-0 bottom-full mb-1 px-2 py-1.5 text-xs font-normal text-gray-100 bg-gray-800 dark:bg-gray-900 rounded shadow-lg whitespace-normal max-w-[220px]">
            {definition}
          </span>
        )}
      </span>
    </span>
  );
}
