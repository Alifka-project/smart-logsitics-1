import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  ArrowRight,
  AlertTriangle,
  FileSpreadsheet,
  History,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import FileUpload, { type FileUploadHandle } from '../Upload/FileUpload';
import SyntheticDataButton from '../Upload/SyntheticDataButton';
import useDeliveryStore from '../../store/useDeliveryStore';
import {
  computePipelineCounts,
  countFailed,
  countReadyToAssign,
  countReturned,
} from '../../utils/pipelineCounts';

interface ManageTabProps {
  onSwitchToDeliveriesTab: () => void;
  onUploadSuccess: (result: { count: number; warnings?: string[] }) => void;
  onUploadError: (result: { errors?: string[] }) => void;
  onSyntheticSuccess: (result: { count: number }) => void;
}

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

function downloadTemplateCsv(): void {
  const headers = 'customer,address,lat,lng,items,phone\n';
  const sample =
    'Sample Customer,Dubai Marina,25.0800,55.1400,Refrigerator ERG123,+971500000000\n';
  const blob = new Blob([headers + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'electrolux-delivery-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ManageTab({
  onSwitchToDeliveriesTab,
  onUploadSuccess,
  onUploadError,
  onSyntheticSuccess,
}: ManageTabProps) {
  const fileUploadRef = useRef<FileUploadHandle>(null);
  const deliveries = useDeliveryStore((s) => s.deliveries);
  const recentUploads = useDeliveryStore((s) => s.recentUploads);
  const loadDeliveries = useDeliveryStore((s) => s.loadDeliveries);

  const [showHistory, setShowHistory] = useState(false);

  const pipeline = useMemo(() => computePipelineCounts(deliveries), [deliveries]);
  const readyAssign = useMemo(() => countReadyToAssign(deliveries), [deliveries]);
  const failedN = useMemo(() => countFailed(deliveries), [deliveries]);
  const returnedN = useMemo(() => countReturned(deliveries), [deliveries]);
  const needsAttention = failedN + returnedN > 0;

  const lastThree = useMemo(() => recentUploads.slice(0, 3), [recentUploads]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const f = acceptedFiles[0];
      if (f) fileUploadRef.current?.processFile(f);
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    disabled: false,
  });

  const stages = useMemo(
    () => [
      {
        key: 'uploaded',
        label: 'Uploaded',
        sub: 'Awaiting SMS',
        n: pipeline.uploaded,
        bg: 'bg-blue-500/15 border-blue-400/50',
        accent: 'text-blue-600 dark:text-blue-400',
      },
      {
        key: 'sms_sent',
        label: 'SMS sent',
        sub: 'Awaiting confirmation',
        n: pipeline.sms_sent,
        bg: 'bg-teal-500/15 border-teal-400/50',
        accent: 'text-teal-600 dark:text-teal-400',
      },
      {
        key: 'confirmed',
        label: 'Confirmed',
        sub: 'Ready to assign',
        n: pipeline.confirmed,
        bg: 'bg-amber-500/15 border-amber-400/50',
        accent: 'text-amber-700 dark:text-amber-400',
      },
      {
        key: 'assigned',
        label: 'Assigned',
        sub: 'On route',
        n: pipeline.assigned,
        bg: 'bg-purple-500/15 border-purple-400/50',
        accent: 'text-purple-600 dark:text-purple-400',
      },
      {
        key: 'delivered',
        label: 'Delivered',
        sub: 'Completed',
        n: pipeline.delivered,
        bg: 'bg-emerald-500/15 border-emerald-400/50',
        accent: 'text-emerald-600 dark:text-emerald-400',
      },
    ],
    [pipeline],
  );

  return (
    <div className="space-y-8">
      <FileUpload
        ref={fileUploadRef}
        hideDefaultUI
        skipNavigate
        onSuccess={(p) =>
          onUploadSuccess({ count: p.count, warnings: p.warnings })
        }
        onError={(e) => onUploadError({ errors: e.errors })}
      />

      {/* 1. Upload area */}
      <section>
        <div
          {...getRootProps({
            className: `
            relative rounded-xl border-2 border-dashed border-blue-500/80 dark:border-blue-400/80
            bg-gray-900/90 dark:bg-gray-950/90 text-center px-4 py-10 sm:py-12
            transition-colors cursor-pointer
            ${isDragActive ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}
          `,
          })}
        >
          <input {...getInputProps()} />
          <Upload className="w-12 h-12 mx-auto text-blue-400 mb-3" aria-hidden />
          <h2 className="text-lg sm:text-xl font-semibold text-white mb-1">
            Upload delivery file
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            Drop Excel file here or click to browse
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold shadow-sm"
            >
              Choose file
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadTemplateCsv();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-lg border border-gray-500 text-gray-200 hover:bg-white/10 text-sm font-medium"
            >
              Download template
            </button>
          </div>
        </div>
        <div className="mt-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Or load sample data</p>
          <SyntheticDataButton
            onLoadSuccess={(r) => {
              onSyntheticSuccess({ count: r.count });
            }}
          />
        </div>
      </section>

      {/* 2. Pipeline */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Pipeline status
        </h3>
        <div className="flex flex-wrap items-stretch justify-center gap-1 sm:gap-2 md:flex-nowrap md:overflow-x-auto pb-2">
          {stages.map((s, i) => (
            <React.Fragment key={s.key}>
              <div
                className={`flex-1 min-w-[100px] max-w-[140px] rounded-lg border p-3 ${s.bg} flex flex-col items-center text-center`}
              >
                <div className={`text-2xl sm:text-3xl font-bold tabular-nums ${s.accent}`}>
                  {s.n}
                </div>
                <div className="text-xs font-medium text-gray-800 dark:text-gray-100 mt-1">
                  {s.label}
                </div>
                <div className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">
                  {s.sub}
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="hidden md:flex items-center text-gray-400 flex-shrink-0 px-0.5">
                  <ArrowRight className="w-5 h-5" aria-hidden />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-5">
          {readyAssign > 0 && (
            <button
              type="button"
              onClick={() => {
                onSwitchToDeliveriesTab();
                useDeliveryStore.getState().setDeliveryListFilter('confirmed');
              }}
              className="inline-flex items-center justify-center gap-1 min-h-[44px] px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-semibold"
            >
              {readyAssign} ready to assign
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onSwitchToDeliveriesTab}
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700/50"
          >
            View all {deliveries.length} deliveries
          </button>
        </div>
      </section>

      {/* 3. Needs attention */}
      {needsAttention && (
        <section className="rounded-xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 pl-1 border-l-4 border-red-500 pr-4 py-4">
            <div className="flex-1 min-w-0 pl-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg" aria-hidden>
                  ⚠️
                </span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  Needs attention
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">
                  {failedN + returnedN}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {failedN} failed deliveries · {returnedN} returned
              </p>
            </div>
            <button
              type="button"
              onClick={onSwitchToDeliveriesTab}
              className="flex-shrink-0 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              View
            </button>
          </div>
        </section>
      )}

      {/* 4. Recent uploads */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Recent uploads
          </h3>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            <History className="w-4 h-4" />
            View history
          </button>
        </div>
        {lastThree.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No uploads yet this session.</p>
        ) : (
          <ul className="space-y-3">
            {lastThree.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 text-sm border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0"
              >
                <FileSpreadsheet className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {u.filename}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {u.orderCount || '—'} orders · Uploaded{' '}
                    {formatDistanceToNow(new Date(u.uploadedAt), { addSuffix: true })}
                  </div>
                </div>
                <span
                  className={
                    u.status === 'processing'
                      ? 'text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-500 text-emerald-700 dark:text-emerald-400'
                      : 'text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }
                >
                  {u.status === 'processing' ? 'Processing' : 'Completed'}
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
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[70vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h4 id="upload-history-title" className="font-semibold text-gray-900 dark:text-gray-100">
                Upload history
              </h4>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              {recentUploads.length === 0 ? (
                <p className="text-sm text-gray-500">No records.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {recentUploads.map((u) => (
                    <li
                      key={u.id}
                      className="flex justify-between gap-2 border-b border-gray-100 dark:border-gray-700 pb-2"
                    >
                      <span className="truncate font-medium">{u.filename}</span>
                      <span className="text-gray-500 whitespace-nowrap">
                        {u.status === 'processing' ? 'Processing' : 'Completed'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
