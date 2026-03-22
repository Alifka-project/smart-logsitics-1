import React from 'react';
import { TrendingUp } from 'lucide-react';
import InsightCard, { InsightType } from './InsightCard';

export interface InsightItem {
  message: string;
  type?: InsightType;
}

interface InsightPanelProps {
  title?: string;
  insights: InsightItem[];
  className?: string;
}

export default function InsightPanel({ title = 'Management Insights', insights, className = '' }: InsightPanelProps): React.ReactElement {
  if (insights.length === 0) return <></>;

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary-500" />
        {title}
      </h3>
      <div className="space-y-2">
        {insights.map((insight, idx) => (
          <InsightCard key={idx} message={insight.message} type={insight.type ?? 'neutral'} />
        ))}
      </div>
    </div>
  );
}
