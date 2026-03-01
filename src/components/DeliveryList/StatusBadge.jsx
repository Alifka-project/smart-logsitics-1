import React from 'react';

const STATUS_CONFIG = {
  'scheduled':                    { dot: 'bg-purple-500',  bg: 'bg-purple-50 dark:bg-purple-900/20',  text: 'text-purple-700 dark:text-purple-300',  label: 'Scheduled'              },
  'scheduled-confirmed':          { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',      text: 'text-blue-700 dark:text-blue-300',      label: 'Confirmed'              },
  'out-for-delivery':             { dot: 'bg-indigo-500',  bg: 'bg-indigo-50 dark:bg-indigo-900/20',  text: 'text-indigo-700 dark:text-indigo-300',  label: 'Out for Delivery'       },
  'in-progress':                  { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-900/20',      text: 'text-blue-700 dark:text-blue-300',      label: 'In Progress'            },
  'pending':                      { dot: 'bg-yellow-500',  bg: 'bg-yellow-50 dark:bg-yellow-900/20',  text: 'text-yellow-700 dark:text-yellow-300',  label: 'Pending'                },
  'delivered':                    { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',    text: 'text-green-700 dark:text-green-300',    label: 'Delivered'              },
  'delivered-with-installation':  { dot: 'bg-green-500',   bg: 'bg-green-50 dark:bg-green-900/20',    text: 'text-green-700 dark:text-green-300',    label: 'Delivered + Install'    },
  'delivered-without-installation':{ dot: 'bg-green-500',  bg: 'bg-green-50 dark:bg-green-900/20',    text: 'text-green-700 dark:text-green-300',    label: 'Delivered'              },
  'cancelled':                    { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',        text: 'text-red-700 dark:text-red-300',        label: 'Cancelled'              },
  'rejected':                     { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-900/20',        text: 'text-red-700 dark:text-red-300',        label: 'Rejected'               },
  'rescheduled':                  { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',  text: 'text-orange-700 dark:text-orange-300',  label: 'Rescheduled'            },
  'returned':                     { dot: 'bg-orange-500',  bg: 'bg-orange-50 dark:bg-orange-900/20',  text: 'text-orange-700 dark:text-orange-300',  label: 'Returned'               },
};

export default function StatusBadge({ status }) {
  const key = (status || 'pending').toLowerCase();
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG['pending'];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
