import type { DeliveryStatus } from '../types/delivery';

export type StatusVisualConfig = {
  label: string;
  /** Shorter text for dense table pills (avoids awkward wraps). */
  pillLabel?: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  iconBg: string;
  icon: string;
  badgeStyle: string;
  highlight?: boolean;
  /** Tailwind outline + bg classes used for the highlight ring on StatusMetricCards */
  highlightRing?: string;
};

export const STATUS_CONFIG: Record<DeliveryStatus, StatusVisualConfig> = {
  uploaded: {
    // Electrolux palette — neutral slate for non-urgent "pending" state.
    // Previously bright blue; reduced to match the muted Electrolux tone.
    label: 'Pending Order',
    bgColor: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-200',
    iconBg: 'bg-slate-100',
    icon: '📤',
    badgeStyle: 'bg-slate-100 text-slate-700',
  },
  sms_sent: {
    // Neutral slate — customer was messaged but we're just waiting. Not
    // urgent (No Response / Order Delay cover the escalation tiers).
    label: 'Awaiting Customer',
    pillLabel: 'Awaiting',
    bgColor: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-200',
    iconBg: 'bg-slate-100',
    icon: '💬',
    badgeStyle: 'bg-slate-100 text-slate-700',
  },
  unconfirmed: {
    label: 'No Response',
    bgColor: 'bg-red-50',
    textColor: 'text-red-600',
    borderColor: 'border-red-400',
    iconBg: 'bg-red-100',
    icon: '✗',
    badgeStyle: 'bg-red-100 text-red-700',
    highlight: true,
    highlightRing: 'outline outline-1 outline-red-400 bg-red-50 dark:bg-red-900/20',
  },
  confirmed: {
    label: 'Confirmed',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-600',
    borderColor: 'border-amber-400',
    iconBg: 'bg-amber-100',
    icon: '⚡',
    badgeStyle: 'bg-amber-100 text-amber-700',
    highlight: true,
    highlightRing: 'outline outline-1 outline-amber-400 bg-amber-50 dark:bg-amber-900/20',
  },
  next_shipment: {
    // Neutral slate — scheduled for tomorrow but not an escalation yet.
    // Highlight ring removed so the card doesn't compete visually with
    // the genuinely urgent ones (No Response, Order Delay).
    label: 'Next Shipment',
    pillLabel: 'Next Shipment',
    bgColor: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-200',
    iconBg: 'bg-slate-100',
    icon: '📦',
    badgeStyle: 'bg-slate-100 text-slate-700',
  },
  future_schedule: {
    // Neutral slate — 2+ days out, lowest priority in the attention queue.
    label: 'Future Schedule',
    pillLabel: 'Future Schedule',
    bgColor: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-200',
    iconBg: 'bg-slate-100',
    icon: '📅',
    badgeStyle: 'bg-slate-100 text-slate-700',
  },
  scheduled: {
    label: 'Scheduled',
    bgColor: 'bg-indigo-50',
    textColor: 'text-indigo-600',
    borderColor: 'border-indigo-200',
    iconBg: 'bg-indigo-100',
    icon: '📅',
    badgeStyle: 'bg-indigo-100 text-indigo-700',
  },
  ready_to_dispatch: {
    label: 'Ready to Dispatch',
    pillLabel: 'Ready',
    bgColor: 'bg-teal-50',
    textColor: 'text-teal-700',
    borderColor: 'border-teal-500',
    iconBg: 'bg-teal-100',
    icon: '✅',
    badgeStyle: 'bg-teal-100 text-teal-800 border-teal-400',
    highlight: true,
    highlightRing: 'outline outline-1 outline-teal-400 bg-teal-50 dark:bg-teal-900/20',
  },
  pgi_done: {
    label: 'PGI Done',
    pillLabel: 'PGI Done',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-400',
    iconBg: 'bg-amber-100',
    icon: '📦',
    badgeStyle: 'bg-amber-100 text-amber-800 border-amber-400',
    highlight: true,
    highlightRing: 'outline outline-1 outline-amber-400 bg-amber-50 dark:bg-amber-900/20',
  },
  pickup_confirmed: {
    label: 'Pickup Confirmed',
    pillLabel: 'Pickup Confirmed',
    bgColor: 'bg-teal-50',
    textColor: 'text-teal-700',
    borderColor: 'border-teal-400',
    iconBg: 'bg-teal-100',
    icon: '🚛',
    badgeStyle: 'bg-teal-100 text-teal-800 border-teal-400',
    highlight: true,
    highlightRing: 'outline outline-1 outline-teal-400 bg-teal-50 dark:bg-teal-900/20',
  },
  order_delay: {
    label: 'Order Delay',
    bgColor: 'bg-red-50',
    textColor: 'text-red-600',
    borderColor: 'border-red-300',
    iconBg: 'bg-red-100',
    icon: '⚠',
    badgeStyle: 'bg-red-100 text-red-700',
    highlight: true,
    highlightRing: 'outline outline-1 outline-red-400 bg-red-50 dark:bg-red-900/20',
  },
  out_for_delivery: {
    label: 'On Route',
    pillLabel: 'On Route',
    bgColor: 'bg-[#032145]/8',
    textColor: 'text-[#032145]',
    borderColor: 'border-[#032145]/20 dark:border-blue-400/25',
    iconBg: 'bg-[#032145]/15',
    icon: '🚚',
    badgeStyle:
      'bg-[#032145]/10 text-[#032145] dark:bg-blue-400/15 dark:text-blue-100',
    highlight: true,
    highlightRing: 'outline outline-1 outline-blue-400 bg-blue-50/60 dark:bg-blue-900/20',
  },
  delivered: {
    label: 'Delivered',
    bgColor: 'bg-green-50',
    textColor: 'text-green-600',
    borderColor: 'border-green-200',
    iconBg: 'bg-green-100',
    icon: '✓',
    badgeStyle: 'bg-green-100 text-green-700',
    highlight: true,
    highlightRing: 'outline outline-1 outline-green-400 bg-green-50 dark:bg-green-900/20',
  },
  failed: {
    label: 'Failed',
    bgColor: 'bg-red-50',
    textColor: 'text-red-600',
    borderColor: 'border-red-300',
    iconBg: 'bg-red-100',
    icon: '⚠',
    badgeStyle: 'bg-red-100 text-red-700',
  },
  rescheduled: {
    label: 'Rescheduled',
    bgColor: 'bg-orange-50',
    textColor: 'text-orange-600',
    borderColor: 'border-orange-200',
    iconBg: 'bg-orange-100',
    icon: '🔄',
    badgeStyle: 'bg-orange-100 text-orange-700',
  },
  cancelled: {
    label: 'Cancelled',
    bgColor: 'bg-gray-50',
    textColor: 'text-gray-500',
    borderColor: 'border-gray-200',
    iconBg: 'bg-gray-100',
    icon: '🚫',
    badgeStyle: 'bg-gray-100 text-gray-500',
  },
};

export const BRAND_COLORS = {
  primary: '#032145',
  primaryHover: '#021432',
  secondary: '#f9fafb',
  accent: '#f59e0b',
} as const;
