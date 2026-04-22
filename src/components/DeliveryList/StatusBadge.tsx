import React from 'react';
import { classifyConfirmedDate } from '../../utils/deliveryWorkflowMap';

interface StatusConfig {
  dot: string;
  bg: string;
  text: string;
  label: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  /* Raw DB statuses */
  'scheduled':                      { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-300',  label: 'Awaiting Customer'    },
  'scheduled-confirmed':            { dot: 'bg-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-300',  label: 'Confirmed'            },
  'pgi-done':                       { dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-300',    label: 'PGI Done'             },
  'pgi_done':                       { dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-300',    label: 'PGI Done'             },
  'pickup-confirmed':               { dot: 'bg-teal-500',    bg: 'bg-teal-50 dark:bg-teal-900/20',       text: 'text-teal-700 dark:text-teal-300',      label: 'Ready to Depart'      },
  'pickup_confirmed':               { dot: 'bg-teal-500',    bg: 'bg-teal-50 dark:bg-teal-900/20',       text: 'text-teal-700 dark:text-teal-300',      label: 'Ready to Depart'      },
  'out-for-delivery':               { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-300',      label: 'On Route'             },
  'in-transit':                     { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-300',      label: 'In Transit'           },
  'in-progress':                    { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-300',      label: 'In Progress'          },
  'pending':                        { dot: 'bg-yellow-500',  bg: 'bg-yellow-50 dark:bg-yellow-900/20',   text: 'text-yellow-700 dark:text-yellow-300',  label: 'Pending Order'        },
  'uploaded':                       { dot: 'bg-yellow-500',  bg: 'bg-yellow-50 dark:bg-yellow-900/20',   text: 'text-yellow-700 dark:text-yellow-300',  label: 'Pending Order'        },
  'delivered':                      { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',     text: 'text-green-700 dark:text-green-300',    label: 'Delivered'            },
  'delivered-with-installation':    { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',     text: 'text-green-700 dark:text-green-300',    label: 'Delivered + Install'  },
  'delivered-without-installation': { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',     text: 'text-green-700 dark:text-green-300',    label: 'Delivered'            },
  'completed':                      { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',     text: 'text-green-700 dark:text-green-300',    label: 'Completed'            },
  'pod-completed':                  { dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', label: 'POD Completed'        },
  'cancelled':                      { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-700 dark:text-red-300',        label: 'Cancelled'            },
  'rejected':                       { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-700 dark:text-red-300',        label: 'Rejected'             },
  'rescheduled':                    { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-300',  label: 'Rescheduled'          },
  'returned':                       { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-300',  label: 'Returned'             },
  'failed':                         { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-700 dark:text-red-300',        label: 'Failed'               },
  /* Workflow-derived statuses (underscore form) */
  'out_for_delivery':               { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-300',      label: 'On Route'             },
  'sms_sent':                       { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-700 dark:text-orange-300',  label: 'Awaiting Customer'    },
  'unconfirmed':                    { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-700 dark:text-red-300',        label: 'No Response'  },
  'order_delay':                    { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-700 dark:text-red-300',        label: 'Order Delay'          },
  'next_shipment':                  { dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-300',    label: 'Next Shipment'        },
  'future_schedule':                { dot: 'bg-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-300',  label: 'Future Schedule'      },
};

interface StatusBadgeProps {
  status?: string | null;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const key = (status || 'pending').toLowerCase();
  const fallback: StatusConfig = { dot: 'bg-gray-400', bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300', label: key.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) };
  const cfg = STATUS_CONFIG[key] ?? fallback;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/**
 * RescheduledStatusCell — renders a dual-badge for rescheduled deliveries:
 * [Rescheduled] + [Next Shipment] or [Future Schedule]
 * Falls back to a plain StatusBadge for non-rescheduled statuses.
 */
interface RescheduledStatusCellProps {
  status?: string | null;
  confirmedDeliveryDate?: string | Date | null;
}

export function RescheduledStatusCell({ status, confirmedDeliveryDate }: RescheduledStatusCellProps) {
  const isRescheduled = (status || '').toLowerCase() === 'rescheduled';

  if (isRescheduled && confirmedDeliveryDate) {
    const date = confirmedDeliveryDate instanceof Date
      ? confirmedDeliveryDate
      : new Date(confirmedDeliveryDate as string);

    const tier = classifyConfirmedDate(date); // 'next' | 'future'
    const tierStatus = tier === 'next' ? 'next_shipment' : 'future_schedule';

    return (
      <div className="flex flex-col gap-1">
        <StatusBadge status="rescheduled" />
        <StatusBadge status={tierStatus} />
      </div>
    );
  }

  return <StatusBadge status={status} />;
}
