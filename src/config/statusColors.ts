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
};

export const STATUS_CONFIG: Record<DeliveryStatus, StatusVisualConfig> = {
  uploaded: {
    label: 'Uploaded',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-200',
    iconBg: 'bg-blue-100',
    icon: '📤',
    badgeStyle: 'bg-blue-100 text-blue-700',
  },
  sms_sent: {
    label: 'Awaiting Customer',
    pillLabel: 'Awaiting',
    bgColor: 'bg-emerald-50',
    textColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
    iconBg: 'bg-emerald-100',
    icon: '💬',
    badgeStyle: 'bg-emerald-100 text-emerald-700',
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
  },
  tomorrow_shipment: {
    label: 'Tomorrow Shipment',
    pillLabel: 'Confirmed',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-600',
    borderColor: 'border-amber-400',
    iconBg: 'bg-amber-100',
    icon: '🗓️',
    badgeStyle: 'bg-amber-100 text-amber-700',
    highlight: true,
  },
  next_shipment: {
    label: 'Next Shipment',
    pillLabel: 'Confirmed',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-600',
    borderColor: 'border-amber-400',
    iconBg: 'bg-amber-100',
    icon: '📦',
    badgeStyle: 'bg-amber-100 text-amber-700',
    highlight: true,
  },
  future_shipment: {
    label: 'Future Shipment',
    pillLabel: 'Confirmed',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-600',
    borderColor: 'border-amber-400',
    iconBg: 'bg-amber-100',
    icon: '📅',
    badgeStyle: 'bg-amber-100 text-amber-700',
    highlight: true,
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
  order_delay: {
    label: 'Order Delay',
    bgColor: 'bg-red-50',
    textColor: 'text-red-600',
    borderColor: 'border-red-300',
    iconBg: 'bg-red-100',
    icon: '⚠',
    badgeStyle: 'bg-red-100 text-red-700',
    highlight: true,
  },
  out_for_delivery: {
    label: 'On Route',
    pillLabel: 'On Route',
    bgColor: 'bg-[#002D5B]/8',
    textColor: 'text-[#002D5B]',
    borderColor: 'border-[#002D5B]/20 dark:border-blue-400/25',
    iconBg: 'bg-[#002D5B]/15',
    icon: '🚚',
    badgeStyle:
      'bg-[#002D5B]/10 text-[#002D5B] dark:bg-blue-400/15 dark:text-blue-100',
  },
  delivered: {
    label: 'Delivered',
    bgColor: 'bg-green-50',
    textColor: 'text-green-600',
    borderColor: 'border-green-200',
    iconBg: 'bg-green-100',
    icon: '✓',
    badgeStyle: 'bg-green-100 text-green-700',
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
  primary: '#002D5B',
  primaryHover: '#001f3f',
  secondary: '#f9fafb',
  accent: '#f59e0b',
} as const;
