import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

interface ManageSidebarProps {
  onFileUpload: (file: File) => void;
  onDownloadTemplate: () => void;
  isUploading: boolean;
  /** When true, hides the file upload dropzone (e.g. logistics_team role cannot upload) */
  hideUpload?: boolean;
}

export const ManageSidebar: React.FC<ManageSidebarProps> = ({
  onFileUpload,
  onDownloadTemplate,
  isUploading,
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
