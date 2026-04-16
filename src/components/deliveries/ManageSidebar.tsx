import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DeliveryOrder } from '../../types/delivery';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

interface ManageSidebarProps {
  orders: DeliveryOrder[];
  onFileUpload: (file: File) => void;
  onDownloadTemplate: () => void;
  onAssignConfirmed?: () => void;
  onBulkResendUnconfirmed?: () => void;
  isUploading: boolean;
  todayStats: {
    uploads: number;
    totalOrders: number;
    activeDrivers: number;
    delivered: number;
  };
  /** When true, hides the file upload dropzone (e.g. logistics_team role cannot upload) */
  hideUpload?: boolean;
}

export const ManageSidebar: React.FC<ManageSidebarProps> = ({
  orders,
  onFileUpload,
  onDownloadTemplate,
  onAssignConfirmed,
  onBulkResendUnconfirmed,
  isUploading,
  todayStats,
  hideUpload = false,
}) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) onFileUpload(acceptedFiles[0]);
    },
    [onFileUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    disabled: isUploading,
    noClick: true,
  });

  const confirmedCount = orders.filter((o) => o.status === 'confirmed').length;
  const unconfirmedCount = orders.filter((o) => o.status === 'unconfirmed').length;

  return (
    <div className="space-y-4">
      {!hideUpload && (
        <div
          {...getRootProps()}
          className={`
            p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed cursor-pointer transition-all
            ${isDragActive ? 'border-[#002D5B] bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}
          `}
        >
          <input {...getInputProps()} />
          <div className="text-center">
            <span className="text-2xl mb-2 block" aria-hidden>
              📤
            </span>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {isDragActive ? 'Drop file here' : 'Drop Excel to import'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">.xlsx, .xls, .csv</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              className="text-xs text-[#002D5B] dark:text-blue-400 mt-2 hover:underline"
            >
              or browse files
            </button>
          </div>
        </div>
      )}

      <div className="bg-[#002D5B] rounded-xl p-4 text-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Today&apos;s summary</h3>
          <span className="text-white/50 text-xs" aria-hidden>
            ↗
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white/15 rounded-md flex items-center justify-center">
              <span className="text-xs" aria-hidden>
                📤
              </span>
            </div>
            <div>
              <p className="text-white text-xs font-semibold">{todayStats.uploads}</p>
              <p className="text-white/70 text-[10px] uppercase tracking-wide">Uploads</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white/15 rounded-md flex items-center justify-center">
              <span className="text-xs" aria-hidden>
                📦
              </span>
            </div>
            <div>
              <p className="text-white text-xs font-semibold">{todayStats.totalOrders}</p>
              <p className="text-white/70 text-[10px] uppercase tracking-wide">Orders</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white/15 rounded-md flex items-center justify-center">
              <span className="text-xs" aria-hidden>
                🚚
              </span>
            </div>
            <div>
              <p className="text-white text-xs font-semibold">{todayStats.activeDrivers}</p>
              <p className="text-white/70 text-[10px] uppercase tracking-wide">Drivers</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white/15 rounded-md flex items-center justify-center">
              <span className="text-xs" aria-hidden>
                ✅
              </span>
            </div>
            <div>
              <p className="text-white text-xs font-semibold">{todayStats.delivered}</p>
              <p className="text-white/70 text-[10px] uppercase tracking-wide">Delivered</p>
            </div>
          </div>
        </div>

        {unconfirmedCount > 0 && (
          <div className="mt-3 p-2 bg-white/10 rounded-md">
            <p className="text-xs text-white/90">⚠️ {unconfirmedCount} orders with no customer response</p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">⚡ Quick actions</h3>
        <div className="space-y-2">
          {confirmedCount > 0 && (
            <button
              type="button"
              onClick={onAssignConfirmed}
              className="w-full py-2.5 px-3 bg-amber-50 dark:bg-amber-900/25 text-amber-900 dark:text-amber-100 rounded-lg text-xs font-medium text-center hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200/80 dark:border-amber-800/50"
            >
              Assign {confirmedCount} confirmed orders →
            </button>
          )}
          {unconfirmedCount > 0 && (
            <button
              type="button"
              onClick={onBulkResendUnconfirmed}
              className="w-full py-2.5 px-3 bg-red-50 dark:bg-red-900/25 text-red-900 dark:text-red-100 rounded-lg text-xs font-medium text-center hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200/80 dark:border-red-800/50"
            >
              Resend SMS to {unconfirmedCount} no-response orders →
            </button>
          )}
          {confirmedCount === 0 && unconfirmedCount === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center leading-relaxed">
              No bulk actions right now. Confirmations or unconfirmed orders will show actions here.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">📋 How to use</h3>
        <div className="space-y-3">
          {[
            { num: 1, text: 'Upload Excel with orders', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
            { num: 2, text: 'System sends SMS', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
            { num: 3, text: 'Customer confirms date', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
            { num: 4, text: 'Scheduled or tomorrow', color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
            { num: 5, text: 'Assign drivers & deliver', color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' },
          ].map((step) => (
            <div key={step.num} className="flex items-center gap-2">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold ${step.color}`}
              >
                {step.num}
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-300">{step.text}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onDownloadTemplate}
          className="w-full mt-4 py-2 px-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs text-[#002D5B] dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          📥 Download CSV template →
        </button>
      </div>
    </div>
  );
};
