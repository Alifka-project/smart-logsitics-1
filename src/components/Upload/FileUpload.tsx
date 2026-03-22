import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useNavigate } from 'react-router-dom';
import { validateDeliveryData } from '../../utils/dataValidator';
import { detectDataFormat } from '../../utils/dataTransformer';
import GeocodingProgress from './GeocodingProgress';
import { hasValidCoordinates } from '../../utils/addressHandler';
import api from '../../frontend/apiClient';
import type { Delivery, ValidationResult } from '../../types';

interface FileUploadSuccessPayload {
  count: number;
  warnings: string[];
  format: string;
  geocoded: boolean;
  geocodedCount: number;
}

interface FileUploadErrorPayload {
  errors: string[];
  warnings: string[];
  format?: string;
}

export interface FileUploadHandle {
  processFile: (file: File) => void;
  openFileDialog: () => void;
}

interface FileUploadProps {
  onSuccess?: (payload: FileUploadSuccessPayload) => void;
  onError?: (payload: FileUploadErrorPayload) => void;
  /** Hide built-in dashed upload area (use custom dropzone UI). */
  hideDefaultUI?: boolean;
  /** When true, do not navigate to /deliveries after upload (e.g. Manage tab). */
  skipNavigate?: boolean;
}

interface ExtendedValidationResult extends ValidationResult {
  detectedFormat?: string;
}

interface SaveResult {
  success: boolean;
  saved?: number;
  assigned?: number;
  deliveries?: Delivery[];
  error?: string;
}

const FileUpload = forwardRef<FileUploadHandle, FileUploadProps>(function FileUpload(
  { onSuccess, onError, hideDefaultUI = false, skipNavigate = false },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const beginUploadRecord = useDeliveryStore((state) => state.beginUploadRecord);
  const completeUploadRecord = useDeliveryStore((state) => state.completeUploadRecord);
  const removeUploadRecord = useDeliveryStore((state) => state.removeUploadRecord);
  const navigate = useNavigate();
  const setRoute = useDeliveryStore((state) => state.setRoute);
  const [isLoading, setIsLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<ExtendedValidationResult | null>(null);
  const [showGeocoding, setShowGeocoding] = useState(false);
  const [deliveriesToGeocode, setDeliveriesToGeocode] = useState<Delivery[]>([]);
  const activeUploadIdRef = useRef<string | null>(null);

  void setRoute;

  const abortUploadRecord = useCallback((): void => {
    if (activeUploadIdRef.current) {
      removeUploadRecord(activeUploadIdRef.current);
      activeUploadIdRef.current = null;
    }
  }, [removeUploadRecord]);

  const finishUploadRecord = useCallback(
    (count: number): void => {
      if (activeUploadIdRef.current) {
        completeUploadRecord(activeUploadIdRef.current, count);
        activeUploadIdRef.current = null;
      }
    },
    [completeUploadRecord],
  );

  const saveDeliveriesAndAssign = async (deliveries: Delivery[]): Promise<SaveResult> => {
    try {
      if (!deliveries || deliveries.length === 0) {
        console.warn('[FileUpload] No deliveries to save');
        return { success: false, error: 'No deliveries provided' };
      }

      const deliveriesWithIds = deliveries.map((delivery) => {
        const deliveryCopy: Delivery = { ...delivery };
        if (
          deliveryCopy.id &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            deliveryCopy.id,
          )
        ) {
          delete (deliveryCopy as Record<string, unknown>)['id'];
        }
        return deliveryCopy;
      });

      console.log(`[FileUpload] Saving ${deliveriesWithIds.length} deliveries to database...`);

      if (deliveriesWithIds.length > 0) {
        const first = deliveriesWithIds[0] as Record<string, unknown>;
        console.log('[FileUpload] DEBUG - First delivery being sent:');
        console.log('  customer:', first['customer']);
        console.log('  address:', first['address']);
        console.log('  _originalPONumber:', first['_originalPONumber']);
        console.log('  All keys:', Object.keys(first).join(', '));
      }

      const response = await api.post('/deliveries/upload', { deliveries: deliveriesWithIds });

      if (response.data?.success) {
        console.log(
          `[FileUpload] ✓ Saved ${response.data.saved} deliveries and assigned ${response.data.assigned} to drivers`,
        );
        if (response.data.assigned > 0) {
          console.log(`[FileUpload] Auto-assigned ${response.data.assigned} deliveries to drivers`);
        }

        window.dispatchEvent(
          new CustomEvent('deliveriesUpdated', {
            detail: { count: response.data.saved, assigned: response.data.assigned },
          }),
        );

        return {
          success: true,
          saved: response.data.saved,
          assigned: response.data.assigned,
          deliveries: response.data.deliveries ?? [],
        };
      } else {
        console.error('[FileUpload] Upload response indicates failure:', response.data);
        throw new Error('Upload failed: ' + (response.data?.error ?? 'Unknown error'));
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error('[FileUpload] Error saving deliveries to database:', error);
      console.error('[FileUpload] Error details:', err.response?.data ?? err.message);
      throw error;
    }
  };

  const maybeNavigateDeliveries = useCallback((): void => {
    if (skipNavigate) return;
    try {
      navigate('/deliveries');
    } catch {
      /* ignore */
    }
  }, [navigate, skipNavigate]);

  const processFile = useCallback(
    (file: File | undefined): void => {
      if (!file) return;

      setIsLoading(true);
      setValidationResult(null);
      activeUploadIdRef.current = beginUploadRecord(file.name);

      try {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            let jsonData = XLSX.utils.sheet_to_json(firstSheet) as Record<string, unknown>[];

            if (jsonData.length > 0) {
              const columns = Object.keys(jsonData[0]);
              console.log('[FileUpload] Excel columns detected:', columns);
              console.log('[FileUpload] Looking for PO Number columns...');
              const poColumns = columns.filter((col) => col.toLowerCase().includes('po'));
              console.log('[FileUpload] PO-related columns found:', poColumns);
            }

            const { format, transform } = detectDataFormat(jsonData as import('../../types').RawERPRow[]);
            console.log('[FileUpload] Detected format:', format);

            if (transform) {
              jsonData = transform(jsonData as import('../../types').RawERPRow[]) as unknown as Record<
                string,
                unknown
              >[];
              if (jsonData.length > 0) {
                const sample = jsonData[0];
                console.log('[FileUpload] Transformed deliveries sample:', {
                  customer: sample['customer'],
                  address: sample['address'],
                  _originalDeliveryNumber: sample['_originalDeliveryNumber'],
                  _originalPONumber: sample['_originalPONumber'],
                  _originalQuantity: sample['_originalQuantity'],
                  _originalCity: sample['_originalCity'],
                  _originalRoute: sample['_originalRoute'],
                });
              }
            }

            const validation = validateDeliveryData(jsonData);
            const extValidation: ExtendedValidationResult = {
              ...validation,
              detectedFormat: format,
            };
            setValidationResult(extValidation);

            if (validation.isValid) {
              const needsGeocoding = validation.validData.filter(
                (d) => !hasValidCoordinates(d.lat as number, d.lng as number),
              );

              const fallbackCount = (jsonData || []).filter(
                (d) => d && (d as Record<string, unknown>)['_usedDefaultCoords'],
              ).length;
              if (fallbackCount > 0) {
                if (!validation.warnings) validation.warnings = [];
                validation.warnings.unshift(
                  `Warning: ${fallbackCount} rows used default coordinates because latitude/longitude could not be parsed.`,
                );
              }

              if (needsGeocoding.length > 0) {
                console.log(
                  `[FileUpload] ${needsGeocoding.length}/${validation.validData.length} deliveries need geocoding`,
                );
                setDeliveriesToGeocode(validation.validData);
                setShowGeocoding(true);
              } else {
                console.log(
                  `[FileUpload] All ${validation.validData.length} deliveries have valid coordinates`,
                );

                void (async () => {
                  try {
                    const saveResult = await saveDeliveriesAndAssign(validation.validData);
                    console.log('[FileUpload] Successfully saved to database');

                    if (saveResult.success && saveResult.deliveries?.length) {
                      console.log(
                        `[FileUpload] Loading ${saveResult.deliveries.length} deliveries with database UUIDs`,
                      );
                      loadDeliveries(saveResult.deliveries);
                    } else {
                      console.warn('[FileUpload] No deliveries returned from database, using local data');
                      loadDeliveries(validation.validData);
                    }
                  } catch (error: unknown) {
                    const err = error as { response?: { data?: unknown }; message?: string };
                    console.error('[FileUpload] Database save failed:', error);
                    console.error('[FileUpload] Error response:', err.response?.data);
                    loadDeliveries(validation.validData);
                  }

                  finishUploadRecord(validation.validData.length);
                  maybeNavigateDeliveries();

                  if (onSuccess) {
                    onSuccess({
                      count: validation.validData.length,
                      warnings: validation.warnings,
                      format,
                      geocoded: false,
                      geocodedCount: 0,
                    });
                  }
                })();
              }
            } else {
              abortUploadRecord();
              if (onError) {
                onError({ errors: validation.errors, warnings: validation.warnings, format });
              }
            }
          } catch (error: unknown) {
            const err = error as { message?: string };
            console.error('File processing error:', error);
            abortUploadRecord();
            if (onError) {
              onError({ errors: [`Failed to process file: ${err.message}`], warnings: [] });
            }
          } finally {
            setIsLoading(false);
          }
        };

        reader.onerror = (): void => {
          setIsLoading(false);
          abortUploadRecord();
          if (onError) {
            onError({ errors: ['Failed to read file'], warnings: [] });
          }
        };

        reader.readAsArrayBuffer(file);
      } catch (error: unknown) {
        const err = error as { message?: string };
        console.error('Error reading file:', error);
        setIsLoading(false);
        abortUploadRecord();
        if (onError) {
          onError({ errors: [`Error: ${err.message}`], warnings: [] });
        }
      }
    },
    [
      abortUploadRecord,
      beginUploadRecord,
      finishUploadRecord,
      loadDeliveries,
      maybeNavigateDeliveries,
      onError,
      onSuccess,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      processFile: (file: File) => processFile(file),
      openFileDialog: () => inputRef.current?.click(),
    }),
    [processFile],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    processFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleGeocodingComplete = async (geocodedDeliveries: Delivery[]): Promise<void> => {
    console.log('[FileUpload] Geocoding complete, loading deliveries');
    setShowGeocoding(false);

    const geocodedCount = geocodedDeliveries.filter((d) => d.geocoded === true).length;

    const accuracyOrder: Record<string, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      PROVIDED: 3,
      FAILED: 0,
    };
    const sorted = [...geocodedDeliveries].sort((a, b) => {
      const aScore = accuracyOrder[a.geocodeAccuracy ?? ''] ?? 0;
      const bScore = accuracyOrder[b.geocodeAccuracy ?? ''] ?? 0;
      return bScore - aScore;
    });

    try {
      const saveResult = await saveDeliveriesAndAssign(sorted);

      if (saveResult.success && saveResult.deliveries?.length) {
        console.log(
          `[FileUpload] Loading ${saveResult.deliveries.length} geocoded deliveries with database UUIDs`,
        );
        loadDeliveries(saveResult.deliveries);
      } else {
        console.warn(
          '[FileUpload] No deliveries returned from database after geocoding, using local data',
        );
        loadDeliveries(sorted);
      }

      maybeNavigateDeliveries();

      finishUploadRecord(geocodedDeliveries.length);

      if (onSuccess) {
        onSuccess({
          count: geocodedDeliveries.length,
          warnings: validationResult?.warnings ?? [],
          format: validationResult?.detectedFormat ?? 'unknown',
          geocoded: true,
          geocodedCount,
        });
      }
    } catch (error: unknown) {
      console.error('[FileUpload] Error in geocoding complete handler:', error);
      loadDeliveries(sorted);
      maybeNavigateDeliveries();

      finishUploadRecord(geocodedDeliveries.length);

      if (onSuccess) {
        onSuccess({
          count: geocodedDeliveries.length,
          warnings: [
            ...(validationResult?.warnings ?? []),
            'Database save may have failed - deliveries loaded locally',
          ],
          format: validationResult?.detectedFormat ?? 'unknown',
          geocoded: true,
          geocodedCount,
        });
      }
    }
  };

  const handleGeocodingCancel = (): void => {
    console.log('[FileUpload] Geocoding cancelled');
    setShowGeocoding(false);
    abortUploadRecord();
  };

  return (
    <div className="space-y-4">
      {showGeocoding && (
        <GeocodingProgress
          deliveries={deliveriesToGeocode}
          onComplete={(d) => void handleGeocodingComplete(d)}
          onCancel={handleGeocodingCancel}
        />
      )}

      {!hideDefaultUI && (
        <div
          onClick={() => !isLoading && inputRef.current?.click()}
          className={`border-3 border-dashed rounded-lg p-6 sm:p-8 lg:p-12 text-center transition-colors ${
            isLoading
              ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
              : 'border-primary-300 hover:border-primary-500 hover:bg-primary-50 cursor-pointer'
          }`}
        >
          <Upload
            className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 ${
              isLoading ? 'text-gray-400 animate-pulse' : 'text-primary-500'
            }`}
          />
          <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-2">
            {isLoading ? 'Processing file...' : 'Click to Upload Excel or Delivery Note'}
          </h3>
          <p className="text-sm sm:text-base text-gray-500">
            {isLoading
              ? 'Please wait...'
              : 'Supported formats: .xlsx, .xls, .csv (ERP/SAP or Simple format)'}
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        disabled={isLoading}
        className="hidden"
      />

      {validationResult && (
        <div
          className={`rounded-lg p-4 border-l-4 ${
            validationResult.isValid ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
          }`}
        >
          <div className="flex items-start gap-3">
            {validationResult.isValid ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-sm">
              <p
                className={`font-semibold ${
                  validationResult.isValid ? 'text-green-800' : 'text-red-800'
                }`}
              >
                {validationResult.isValid
                  ? `✓ Successfully loaded ${validationResult.validData.length} deliveries`
                  : 'Validation failed'}
              </p>
              {validationResult.detectedFormat && (
                <p className="text-gray-600 text-xs mt-1">
                  Detected format:{' '}
                  <strong>
                    {validationResult.detectedFormat === 'erp'
                      ? 'SAP/ERP (Auto-transformed)'
                      : validationResult.detectedFormat === 'simplified'
                        ? 'Simplified Format'
                        : validationResult.detectedFormat === 'generic'
                          ? 'Generic Format (Transformed)'
                          : 'Unknown Format'}
                  </strong>
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
});

export default FileUpload;
