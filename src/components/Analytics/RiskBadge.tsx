import React from 'react';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskBadgeProps {
  level: RiskLevel;
  label?: string;
  className?: string;
}

const STYLES: Record<RiskLevel, string> = {
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export default function RiskBadge({ level, label, className = '' }: RiskBadgeProps): React.ReactElement {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STYLES[level]} ${className}`}>
      {label ?? LABELS[level]}
    </span>
  );
}

/** Derive risk from success rate (0–100) */
export function riskFromSuccessRate(rate: number): RiskLevel {
  if (rate >= 90) return 'low';
  if (rate >= 70) return 'medium';
  if (rate >= 50) return 'high';
  return 'critical';
}

/** Derive risk from pending rate (0–100) */
export function riskFromPendingRate(rate: number): RiskLevel {
  if (rate <= 10) return 'low';
  if (rate <= 25) return 'medium';
  if (rate <= 50) return 'high';
  return 'critical';
}
