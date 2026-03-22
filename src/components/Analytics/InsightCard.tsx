import React from 'react';
import { Lightbulb } from 'lucide-react';

export type InsightType = 'info' | 'warning' | 'success' | 'neutral';

interface InsightCardProps {
  message: string;
  type?: InsightType;
  className?: string;
}

const STYLES: Record<InsightType, string> = {
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  neutral: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300',
};

export default function InsightCard({ message, type = 'neutral', className = '' }: InsightCardProps): React.ReactElement {
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${STYLES[type]} ${className}`}>
      <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <p className="text-sm leading-snug">{message}</p>
    </div>
  );
}
