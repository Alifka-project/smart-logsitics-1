import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { PipelineCounts } from '../../utils/pipelineCounts';

interface PipelineStatusProps {
  pipeline: PipelineCounts;
  onViewAllDeliveries: () => void;
  onReadyToAssign: () => void;
  readyAssignCount: number;
  totalDeliveries: number;
}

const STAGES: {
  key: keyof PipelineCounts;
  label: string;
  sub: string;
  w: number;
  h: number;
  bg: string;
  border: string;
  borderW: string;
  num: string;
  lbl: string;
  subColor: string;
}[] = [
  {
    key: 'uploaded',
    label: 'Uploaded',
    sub: 'Awaiting SMS',
    w: 108,
    h: 85,
    bg: '#DBEAFE',
    border: '#3B82F6',
    borderW: '1px',
    num: '#1E40AF',
    lbl: '#1D4ED8',
    subColor: '#3B82F6',
  },
  {
    key: 'sms_sent',
    label: 'SMS sent',
    sub: 'Awaiting OK',
    w: 108,
    h: 85,
    bg: '#D1FAE5',
    border: '#10B981',
    borderW: '1px',
    num: '#065F46',
    lbl: '#047857',
    subColor: '#10B981',
  },
  {
    key: 'confirmed',
    label: 'Confirmed',
    sub: 'Ready to assign',
    w: 118,
    h: 95,
    bg: '#FEF3C7',
    border: '#F59E0B',
    borderW: '2px',
    num: '#92400E',
    lbl: '#B45309',
    subColor: '#D97706',
  },
  {
    key: 'assigned',
    label: 'Assigned',
    sub: 'On route',
    w: 108,
    h: 85,
    bg: '#EDE9FE',
    border: '#8B5CF6',
    borderW: '1px',
    num: '#5B21B6',
    lbl: '#6D28D9',
    subColor: '#7C3AED',
  },
  {
    key: 'delivered',
    label: 'Delivered',
    sub: 'Completed',
    w: 108,
    h: 85,
    bg: '#D1FAE5',
    border: '#10B981',
    borderW: '1px',
    num: '#065F46',
    lbl: '#047857',
    subColor: '#10B981',
  },
];

export default function PipelineStatus({
  pipeline,
  onViewAllDeliveries,
  onReadyToAssign,
  readyAssignCount,
  totalDeliveries,
}: PipelineStatusProps) {
  return (
    <section className="pp-dash-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-4">
        Pipeline detail
      </h3>
      <div className="flex flex-wrap items-end justify-center gap-1 md:gap-0 md:flex-nowrap md:overflow-x-auto pb-2">
        {STAGES.map((s, i) => {
          const n = pipeline[s.key];
          const isDelivered = s.key === 'delivered';
          const faded = isDelivered && n === 0;
          return (
            <React.Fragment key={s.key}>
              <div
                className="flex flex-col items-center justify-center rounded-lg flex-shrink-0 px-2 py-2 text-center transition-opacity"
                style={{
                  width: s.w,
                  minHeight: s.h,
                  backgroundColor: s.bg,
                  border: `${s.borderW} solid ${s.border}`,
                  opacity: faded ? 0.5 : 1,
                }}
              >
                <span className="text-2xl font-bold tabular-nums" style={{ color: s.num }}>
                  {n}
                </span>
                <span className="text-xs font-semibold leading-tight mt-1" style={{ color: s.lbl }}>
                  {s.label}
                </span>
                <span className="text-[10px] font-medium mt-0.5" style={{ color: s.subColor }}>
                  {s.sub}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className="hidden md:flex items-end pb-4 px-0.5 flex-shrink-0">
                  <ArrowRight className="w-5 h-5 text-[#9CA3AF]" strokeWidth={1.5} aria-hidden />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-5">
        {readyAssignCount > 0 && (
          <button
            type="button"
            onClick={onReadyToAssign}
            className="inline-flex items-center justify-center gap-1 min-h-[44px] px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-semibold"
          >
            {readyAssignCount} ready to assign →
          </button>
        )}
        <button
          type="button"
          onClick={onViewAllDeliveries}
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50"
        >
          View all {totalDeliveries} deliveries
        </button>
      </div>
    </section>
  );
}
