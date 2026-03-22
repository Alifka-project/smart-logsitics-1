import React, { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { UploadRecord } from '../../store/useDeliveryStore';

interface RecentUploadsProps {
  uploads: UploadRecord[];
}

export default function RecentUploads({ uploads }: RecentUploadsProps) {
  const [showHistory, setShowHistory] = useState(false);
  const rows = useMemo(() => (uploads ?? []).slice(0, 5), [uploads]);

  return (
    <>
      <section className="pp-dash-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Recent uploads</h3>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="text-sm font-medium text-[#2563EB] hover:underline"
          >
            View history →
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No file uploads yet. Use the upload area above to import orders from Excel or CSV.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700 rounded-lg border border-slate-100 dark:border-slate-700 overflow-hidden">
            {rows.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 text-sm bg-slate-50/80 dark:bg-slate-900/20 px-3 py-3"
              >
                <FileSpreadsheet className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{u.filename}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {u.orderCount || '—'} orders · {formatDistanceToNow(new Date(u.uploadedAt), { addSuffix: true })}
                  </div>
                </div>
                <span
                  className={
                    u.status === 'processing'
                      ? 'text-xs font-semibold px-2.5 py-1 rounded-full border border-[#3B82F6] text-[#1D4ED8]'
                      : u.status === 'error'
                        ? 'text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FEE2E2] text-[#991B1B]'
                        : 'text-xs font-semibold px-2.5 py-1 rounded-full bg-[#D1FAE5] text-[#065F46]'
                  }
                >
                  {u.status === 'processing'
                    ? 'Processing'
                    : u.status === 'error'
                      ? 'Error'
                      : 'Completed'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showHistory && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-history-title"
        >
          <div className="pp-dash-card shadow-2xl max-w-lg w-full max-h-[70vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h4 id="upload-history-title" className="font-semibold text-slate-900 dark:text-slate-100">
                Upload history
              </h4>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {uploads.length === 0 ? (
                <p className="text-sm text-slate-500">No records.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {uploads.map((u) => (
                    <li
                      key={u.id}
                      className="flex justify-between gap-2 border-b border-slate-100 dark:border-slate-700 pb-2"
                    >
                      <span className="truncate font-medium">{u.filename}</span>
                      <span className="text-slate-500 whitespace-nowrap">
                        {u.status === 'processing'
                          ? 'Processing'
                          : u.status === 'error'
                            ? 'Error'
                            : 'Completed'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
