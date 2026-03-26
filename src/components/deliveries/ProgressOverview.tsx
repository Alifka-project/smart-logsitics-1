import React, { useMemo } from 'react';
import type { PipelineCounts } from '../../utils/pipelineCounts';
import { getProgressWidths } from '../../utils/progressWidths';

interface ProgressOverviewProps {
  pipeline: PipelineCounts;
  total: number;
}

const LEGEND = [
  { key: 'uploaded', label: 'Pending Order', color: '#3B82F6' },
  { key: 'smsSent', label: 'Awaiting Customer', color: '#0F6E56' },
  { key: 'confirmed', label: 'Confirmed', color: '#D97706' },
  { key: 'assigned', label: 'Assigned', color: '#7C3AED' },
  { key: 'delivered', label: 'Delivered', color: '#10B981' },
] as const;

export default function ProgressOverview({ pipeline, total }: ProgressOverviewProps) {
  const w = useMemo(() => getProgressWidths(pipeline, total), [pipeline, total]);

  return (
    <section className="pp-dash-card p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Order progress</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {total} total {total === 1 ? 'order' : 'orders'}
        </p>
      </div>
      <div className="flex h-4 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
        <div
          className="h-full flex-none min-w-0"
          style={{ width: `${w.uploaded}%`, backgroundColor: '#3B82F6' }}
          title="Pending Order"
        />
        <div
          className="h-full flex-none min-w-0"
          style={{ width: `${w.smsSent}%`, backgroundColor: '#0F6E56' }}
          title="Awaiting Customer"
        />
        <div
          className="h-full flex-none min-w-0"
          style={{ width: `${w.confirmed}%`, backgroundColor: '#D97706' }}
          title="Confirmed"
        />
        <div
          className="h-full flex-none min-w-0"
          style={{ width: `${w.assigned}%`, backgroundColor: '#7C3AED' }}
          title="Assigned"
        />
        <div
          className="h-full flex-none min-w-0"
          style={{ width: `${w.delivered}%`, backgroundColor: '#10B981' }}
          title="Delivered"
        />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs text-slate-600 dark:text-slate-300">
        {LEGEND.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
