import React, { useRef } from 'react';
import { Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import useDeliveryStore from '../../store/useDeliveryStore';

export default function FileUpload() {
  const inputRef = useRef();
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);
      
      loadDeliveries(jsonData);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      className="border-3 border-dashed border-purple-300 rounded-lg p-12 text-center cursor-pointer hover:border-purple-500 hover:bg-purple-50 transition-colors"
    >
      <Upload className="w-16 h-16 text-purple-500 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-gray-700 mb-2">
        Click to Upload Excel or Delivery Note
      </h3>
      <p className="text-gray-500">Supported formats: .xlsx, .xls, .csv</p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

