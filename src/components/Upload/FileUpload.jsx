import React, { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import useDeliveryStore from '../../store/useDeliveryStore';
import { validateDeliveryData } from '../../utils/dataValidator';
import { detectDataFormat } from '../../utils/dataTransformer';
import GeocodingProgress from './GeocodingProgress';
import { hasValidCoordinates } from '../../utils/addressHandler';

export default function FileUpload({ onSuccess, onError }) {
  const inputRef = useRef();
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [showGeocoding, setShowGeocoding] = useState(false);
  const [deliveriesToGeocode, setDeliveriesToGeocode] = useState([]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setValidationResult(null);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          let jsonData = XLSX.utils.sheet_to_json(firstSheet);

          // Detect data format and transform if needed
          const { format, transform } = detectDataFormat(jsonData);
          
          if (transform) {
            // Transform data to simplified format
            jsonData = transform(jsonData);
          }

          // Validate the transformed data
          const validation = validateDeliveryData(jsonData);
          setValidationResult({
            ...validation,
            detectedFormat: format
          });

          if (validation.isValid) {
            // Check if any deliveries need geocoding
            const needsGeocoding = validation.validData.filter(d => 
              !hasValidCoordinates(d.lat, d.lng)
            );

            if (needsGeocoding.length > 0) {
              console.log(`[FileUpload] ${needsGeocoding.length}/${validation.validData.length} deliveries need geocoding`);
              setDeliveriesToGeocode(validation.validData);
              setShowGeocoding(true);
            } else {
              // All deliveries have valid coordinates, load directly
              console.log(`[FileUpload] All ${validation.validData.length} deliveries have valid coordinates`);
              loadDeliveries(validation.validData);
              if (onSuccess) {
                onSuccess({
                  count: validation.validData.length,
                  warnings: validation.warnings,
                  format: format,
                  geocoded: false,
                  geocodedCount: 0
                });
              }
            }
          } else {
            if (onError) {
              onError({
                errors: validation.errors,
                warnings: validation.warnings,
                format: format
              });
            }
          }
        } catch (error) {
          console.error('File processing error:', error);
          if (onError) {
            onError({
              errors: [`Failed to process file: ${error.message}`],
              warnings: []
            });
          }
        } finally {
          setIsLoading(false);
        }
      };

      reader.onerror = () => {
        setIsLoading(false);
        if (onError) {
          onError({
            errors: ['Failed to read file'],
            warnings: []
          });
        }
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Error reading file:', error);
      setIsLoading(false);
      if (onError) {
        onError({
          errors: [`Error: ${error.message}`],
          warnings: []
        });
      }
    }
  };

  const handleGeocodingComplete = (geocodedDeliveries) => {
    console.log('[FileUpload] Geocoding complete, loading deliveries');
    setShowGeocoding(false);
    
    const geocodedCount = geocodedDeliveries.filter(d => d.geocoded === true).length;
    
    loadDeliveries(geocodedDeliveries);
    if (onSuccess) {
      onSuccess({
        count: geocodedDeliveries.length,
        warnings: validationResult.warnings,
        format: validationResult.detectedFormat,
        geocoded: true,
        geocodedCount: geocodedCount
      });
    }
  };

  const handleGeocodingCancel = () => {
    console.log('[FileUpload] Geocoding cancelled');
    setShowGeocoding(false);
  };

  return (
    <div className="space-y-4">
      {showGeocoding && (
        <GeocodingProgress 
          deliveries={deliveriesToGeocode}
          onComplete={handleGeocodingComplete}
          onCancel={handleGeocodingCancel}
        />
      )}
      
      <div
        onClick={() => !isLoading && inputRef.current?.click()}
        className={`border-3 border-dashed rounded-lg p-6 sm:p-8 lg:p-12 text-center transition-colors ${
          isLoading
            ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
            : 'border-purple-300 hover:border-purple-500 hover:bg-purple-50 cursor-pointer'
        }`}
      >
        <Upload className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 ${
          isLoading ? 'text-gray-400 animate-pulse' : 'text-purple-500'
        }`} />
        <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-2">
          {isLoading ? 'Processing file...' : 'Click to Upload Excel or Delivery Note'}
        </h3>
        <p className="text-sm sm:text-base text-gray-500">
          {isLoading ? 'Please wait...' : 'Supported formats: .xlsx, .xls, .csv (ERP/SAP or Simple format)'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          disabled={isLoading}
          className="hidden"
        />
      </div>

      {validationResult && (
        <div className={`rounded-lg p-4 border-l-4 ${
          validationResult.isValid
            ? 'bg-green-50 border-green-500'
            : 'bg-red-50 border-red-500'
        }`}>
          <div className="flex items-start gap-3">
            {validationResult.isValid ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-sm">
              <p className={`font-semibold ${
                validationResult.isValid ? 'text-green-800' : 'text-red-800'
              }`}>
                {validationResult.isValid
                  ? `✓ Successfully loaded ${validationResult.validData.length} deliveries`
                  : 'Validation failed'}
              </p>
              {validationResult.detectedFormat && (
                <p className="text-gray-600 text-xs mt-1">
                  Detected format: <strong>{
                    validationResult.detectedFormat === 'erp' ? 'SAP/ERP (Auto-transformed)' :
                    validationResult.detectedFormat === 'simplified' ? 'Simplified Format' :
                    validationResult.detectedFormat === 'generic' ? 'Generic Format (Transformed)' :
                    'Unknown Format'
                  }</strong>
                </p>
              )}
              {validationResult.errors.length > 0 && (
                <div className="mt-2 text-red-700 whitespace-pre-wrap">
                  {validationResult.errors.join('\n')}
                </div>
              )}
              {validationResult.warnings.length > 0 && (
                <div className="mt-2 text-amber-700 whitespace-pre-wrap">
                  <p className="font-semibold mb-1">Warnings:</p>
                  {validationResult.warnings.join('\n')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

