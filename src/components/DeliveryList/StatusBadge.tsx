import React from 'react';

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
  'next_shipment':                  { dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-300',    label: 'Confirmed'            },
  'future_schedule':                { dot: 'bg-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-300',  label: 'Confirmed'            },
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
