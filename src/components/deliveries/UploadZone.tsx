import React, { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import type { FileUploadHandle } from '../Upload/FileUpload';
import { generateFileHash } from '../../utils/fileHash';
import useDeliveryStore from '../../store/useDeliveryStore';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

interface UploadZoneProps {
  fileUploadRef: React.RefObject<FileUploadHandle | null>;
  onDuplicate: () => void;
  onUploadErrorToast: (message: string) => void;
}

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

export default function UploadZone({
  fileUploadRef,
  onDuplicate,
  onUploadErrorToast,
}: UploadZoneProps) {
  const isFileAlreadyUploaded = useDeliveryStore((s) => s.isFileAlreadyUploaded);
  const pendingHashes = useRef<Set<string>>(new Set());

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const f = acceptedFiles[0];
      if (!f) return;
      try {
        const hash = await generateFileHash(f);
        if (isFileAlreadyUploaded(hash)) {
          onDuplicate();
          return;
        }
        if (pendingHashes.current.has(hash)) {
          onUploadErrorToast('This file is already being processed.');
          return;
        }
        pendingHashes.current.add(hash);
        window.setTimeout(() => pendingHashes.current.delete(hash), 15_000);
        fileUploadRef.current?.processFile(f, { fileHash: hash });
      } catch {
        onUploadErrorToast('Could not read file. Try again.');
      }
    },
    [fileUploadRef, isFileAlreadyUploaded, onDuplicate, onUploadErrorToast],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files) => void onDrop(files),
    accept: ACCEPT,
    multiple: false,
    disabled: false,
  });

  return (
    <section aria-label="Upload delivery spreadsheet">
      <div
        {...getRootProps({
          className: `
            relative flex flex-col justify-center rounded-lg overflow-hidden cursor-pointer
            min-h-[90px] max-h-[90px] px-4 py-2
            bg-[#1e293b] border border-dashed border-[#3b82f6]
            transition-shadow
            ${isDragActive ? 'ring-2 ring-[#3b82f6] ring-offset-2 ring-offset-[#1e293b]' : ''}
          `,
        })}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-center gap-1 sm:gap-4 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:gap-3 min-w-0">
            <Upload className="w-5 h-5 text-[#60a5fa] flex-shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white leading-tight">
                Drop Excel file here or click to upload
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                Accepts .xlsx, .xls, .csv
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              className="text-xs font-semibold text-white/90 hover:text-white underline-offset-2 hover:underline"
            >
              Browse files
            </button>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                downloadTemplateCsv();
              }}
              className="text-xs font-medium text-[#93c5fd] hover:text-white"
            >
              Download template →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
