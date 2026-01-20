import React, { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useNavigate } from 'react-router-dom';
import { validateDeliveryData } from '../../utils/dataValidator';
import { detectDataFormat } from '../../utils/dataTransformer';
import GeocodingProgress from './GeocodingProgress';
import { hasValidCoordinates } from '../../utils/addressHandler';
import api from '../../frontend/apiClient';

export default function FileUpload({ onSuccess, onError }) {
  const inputRef = useRef();
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const navigate = useNavigate();
  const setRoute = useDeliveryStore((state) => state.setRoute);
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

          // Log available column names for debugging
          if (jsonData.length > 0) {
            const columns = Object.keys(jsonData[0]);
            console.log('[FileUpload] Excel columns detected:', columns);
            console.log('[FileUpload] Looking for PO Number columns...');
            const poColumns = columns.filter(col => col.toLowerCase().includes('po'));
            console.log('[FileUpload] PO-related columns found:', poColumns);
          }

          // Detect data format and transform if needed
          const { format, transform } = detectDataFormat(jsonData);
          console.log('[FileUpload] Detected format:', format);
          
          if (transform) {
            // Transform data to simplified format
            jsonData = transform(jsonData);
            // Log transformed data to see PO Numbers and delivery data
            if (jsonData.length > 0) {
              console.log('[FileUpload] Transformed deliveries sample:', {
                customer: jsonData[0].customer,
                address: jsonData[0].address,
                _originalDeliveryNumber: jsonData[0]._originalDeliveryNumber,
                _originalPONumber: jsonData[0]._originalPONumber,
                _originalQuantity: jsonData[0]._originalQuantity,
                _originalCity: jsonData[0]._originalCity,
                _originalRoute: jsonData[0]._originalRoute,
              });
            }
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

            // Count how many rows used default coordinates during transformation
            const fallbackCount = (jsonData || []).filter(d => d && d._usedDefaultCoords).length;
            if (fallbackCount > 0) {
              validation.warnings = validation.warnings || [];
              validation.warnings.unshift(`Warning: ${fallbackCount} rows used default coordinates because latitude/longitude could not be parsed.`);
            }

            if (needsGeocoding.length > 0) {
              console.log(`[FileUpload] ${needsGeocoding.length}/${validation.validData.length} deliveries need geocoding`);
              setDeliveriesToGeocode(validation.validData);
              setShowGeocoding(true);
            } else {
              // All deliveries have valid coordinates, load directly
              console.log(`[FileUpload] All ${validation.validData.length} deliveries have valid coordinates`);
              
              // Save to database and auto-assign drivers (async IIFE to await)
              (async () => {
                try {
                  await saveDeliveriesAndAssign(validation.validData);
                  console.log('[FileUpload] Successfully saved to database');
                } catch (error) {
                  console.error('[FileUpload] Database save failed:', error);
                  console.error('[FileUpload] Error response:', error.response?.data);
                  // Continue with local load even if database save fails
                }
                
                loadDeliveries(validation.validData);
                try { navigate('/deliveries'); } catch (e) { /* ignore */ }
                
                if (onSuccess) {
                  onSuccess({
                    count: validation.validData.length,
                    warnings: validation.warnings,
                    format: format,
                    geocoded: false,
                    geocodedCount: 0
                  });
                }
              })();
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

  const handleGeocodingComplete = async (geocodedDeliveries) => {
    console.log('[FileUpload] Geocoding complete, loading deliveries');
    setShowGeocoding(false);
    
    const geocodedCount = geocodedDeliveries.filter(d => d.geocoded === true).length;
    
    // Sort by geocode accuracy so HIGH/MEDIUM appear first, LOW/FAILED last
    const accuracyOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'PROVIDED': 3, 'FAILED': 0 };
    const sorted = [...geocodedDeliveries].sort((a, b) => {
      const aScore = accuracyOrder[a.geocodeAccuracy] || 0;
      const bScore = accuracyOrder[b.geocodeAccuracy] || 0;
      return bScore - aScore;
    });

    try {
      // Save to database and auto-assign drivers - await this to ensure it completes
      await saveDeliveriesAndAssign(sorted);
      
      // Load deliveries into store
      loadDeliveries(sorted);
      
      // Navigate to list view (route calculation will happen when Map tab is opened)
      try { 
        navigate('/deliveries'); 
      } catch (e) { 
        console.warn('[FileUpload] Navigation error:', e);
      }
      
      if (onSuccess) {
        onSuccess({
          count: geocodedDeliveries.length,
          warnings: validationResult?.warnings || [],
          format: validationResult?.detectedFormat || 'unknown',
          geocoded: true,
          geocodedCount: geocodedCount
        });
      }
    } catch (error) {
      console.error('[FileUpload] Error in geocoding complete handler:', error);
      // Still load deliveries even if database save failed
      loadDeliveries(sorted);
      try { navigate('/deliveries'); } catch (e) { /* ignore */ }
      
      if (onSuccess) {
        onSuccess({
          count: geocodedDeliveries.length,
          warnings: [...(validationResult?.warnings || []), 'Database save may have failed - deliveries loaded locally'],
          format: validationResult?.detectedFormat || 'unknown',
          geocoded: true,
          geocodedCount: geocodedCount
        });
      }
    }
  };

  const handleGeocodingCancel = () => {
    console.log('[FileUpload] Geocoding cancelled');
    setShowGeocoding(false);
  };

  // Save deliveries to database and auto-assign drivers
  const saveDeliveriesAndAssign = async (deliveries) => {
    try {
      if (!deliveries || deliveries.length === 0) {
        console.warn('[FileUpload] No deliveries to save');
        return { success: false, error: 'No deliveries provided' };
      }

      // Prepare deliveries with IDs - remove IDs that aren't valid UUIDs (backend will generate new ones)
      const deliveriesWithIds = deliveries.map((delivery, index) => {
        const deliveryCopy = { ...delivery };
        // Only keep ID if it's a valid UUID format, otherwise let backend generate UUID
        if (deliveryCopy.id && !deliveryCopy.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          delete deliveryCopy.id; // Let backend generate valid UUID
        }
        return deliveryCopy;
      });

      console.log(`[FileUpload] Saving ${deliveriesWithIds.length} deliveries to database...`);
      
      // Log what we're sending for the first delivery
      if (deliveriesWithIds.length > 0) {
        console.log('[FileUpload] DEBUG - First delivery being sent:');
        console.log('  customer:', deliveriesWithIds[0].customer);
        console.log('  address:', deliveriesWithIds[0].address);
        console.log('  _originalPONumber:', deliveriesWithIds[0]._originalPONumber);
        console.log('  All keys:', Object.keys(deliveriesWithIds[0]).join(', '));
      }

      // Save to database and trigger auto-assignment
      const response = await api.post('/deliveries/upload', {
        deliveries: deliveriesWithIds
      });

      if (response.data?.success) {
        console.log(`[FileUpload] ✓ Saved ${response.data.saved} deliveries and assigned ${response.data.assigned} to drivers`);
        
        // Show assignment results if any
        if (response.data.assigned > 0) {
          console.log(`[FileUpload] Auto-assigned ${response.data.assigned} deliveries to drivers`);
        }
        
        // Dispatch custom event to trigger dashboard refresh
        window.dispatchEvent(new CustomEvent('deliveriesUpdated', {
          detail: { count: response.data.saved, assigned: response.data.assigned }
        }));
        
        return { success: true, saved: response.data.saved, assigned: response.data.assigned };
      } else {
        console.error('[FileUpload] Upload response indicates failure:', response.data);
        throw new Error('Upload failed: ' + (response.data?.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[FileUpload] Error saving deliveries to database:', error);
      console.error('[FileUpload] Error details:', error.response?.data || error.message);
      // Re-throw so caller can handle it
      throw error;
    }
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
            : 'border-primary-300 hover:border-primary-500 hover:bg-primary-50 cursor-pointer'
        }`}
      >
        <Upload className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 ${
          isLoading ? 'text-gray-400 animate-pulse' : 'text-primary-500'
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

