import React, { useState, useCallback } from 'react';
import { AlertCircle, CheckCircle, Loader, MapPin } from 'lucide-react';
import { isValidDubaiCoordinates } from '../../services/geocodingService';
import {
  prepareAddressForGeocoding,
  mergeGeocodedResult,
  generateGeocodeSummary,
} from '../../utils/addressHandler';
import { Toast } from '../common/Toast';
import type { Delivery, GeocodeSummary } from '../../types';

interface GeocodingProgressProps {
  deliveries: Delivery[];
  onComplete: (geocodedDeliveries: Delivery[]) => void;
  onCancel: () => void;
}

interface ToastState {
  type: string;
  message: string;
}

export default function GeocodingProgress({
  deliveries,
  onComplete,
  onCancel,
}: GeocodingProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentAddress, setCurrentAddress] = useState('');
  const [results, setResults] = useState<Delivery[]>([]);
  const [isCancelled, setIsCancelled] = useState(false);
  const [showToast, setShowToast] = useState<ToastState | null>(null);

  const performGeocoding = useCallback(async () => {
    try {
      const totalDeliveries = deliveries.length;
      console.log(`[GeocodingProgress] Starting geocoding for ${totalDeliveries} deliveries`);

      const geocodedDeliveries: Delivery[] = [];

      for (let i = 0; i < deliveries.length; i++) {
        if (isCancelled) break;

        const delivery = deliveries[i];
        setCurrentAddress(delivery.address || '');

        const addressData = prepareAddressForGeocoding(delivery);

        if (addressData.hasCoordinates && isValidDubaiCoordinates(delivery.lat as number, delivery.lng as number)) {
          geocodedDeliveries.push({
            ...delivery,
            geocoded: true,
            geocodeAccuracy: 'HIGH',
            geocodeDisplayName: delivery.address ?? undefined,
          });
          console.log(`[Geocoding] Skipped (has coordinates): ${delivery.address}`);
        } else {
          const { geocodeAddress } = await import('../../services/geocodingService');
          const geocodeResult = await geocodeAddress(delivery.address || '', addressData.city);

          if (geocodeResult.lat !== null && geocodeResult.lng !== null) {
            geocodedDeliveries.push(mergeGeocodedResult(delivery, geocodeResult));
            setShowToast({ type: 'success', message: `✓ Geocoded: ${delivery.address}` });
          } else {
            geocodedDeliveries.push(mergeGeocodedResult(delivery, geocodeResult));
            setShowToast({ type: 'warning', message: `⚠ Failed: ${delivery.address} - Using defaults` });
          }
        }

        const newProgress = Math.round(((i + 1) / totalDeliveries) * 100);
        setProgress(newProgress);
        setResults([...geocodedDeliveries]);
      }

      console.log('[GeocodingProgress] Completed. Summary:', generateGeocodeSummary(geocodedDeliveries));

      if (!isCancelled) {
        onComplete(geocodedDeliveries);
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error('[GeocodingProgress] Error:', error);
      setShowToast({ type: 'error', message: `Geocoding error: ${err.message}` });
    }
  }, [deliveries, isCancelled, onComplete]);

  React.useEffect(() => {
    void performGeocoding();
  }, [performGeocoding]);

  const handleCancel = (): void => {
    setIsCancelled(true);
    onCancel();
  };

  const summary: GeocodeSummary = generateGeocodeSummary(results);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-6">
          <MapPin className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-800">Geocoding Addresses</h2>
        </div>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              {summary.total > 0 ? `${summary.geocoded}/${summary.total}` : 'Starting...'}
            </span>
            <span className="text-sm font-medium text-gray-700">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-800 h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mb-6 p-3 bg-gray-50 rounded border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Current Address:</p>
          <p className="text-sm font-medium text-gray-800 truncate">{currentAddress}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-green-50 p-3 rounded">
            <div className="text-2xl font-bold text-green-600">{summary.geocoded}</div>
            <div className="text-xs text-green-700">Geocoded</div>
          </div>
          <div className="bg-yellow-50 p-3 rounded">
            <div className="text-2xl font-bold text-yellow-600">{summary.failed}</div>
            <div className="text-xs text-yellow-700">Failed</div>
          </div>
          <div className="bg-blue-50 p-3 rounded">
            <div className="text-2xl font-bold text-blue-600">{summary.skipped}</div>
            <div className="text-xs text-blue-700">Skipped</div>
          </div>
        </div>

        {summary.geocoded > 0 && (
          <div className="mb-6 p-3 bg-blue-50 rounded border border-blue-200">
            <p className="text-xs font-semibold text-blue-900 mb-2">Accuracy Breakdown:</p>
            <div className="space-y-1 text-xs text-blue-800">
              {summary.byAccuracy.HIGH > 0 && (
                <div className="flex justify-between">
                  <span>HIGH:</span>
                  <span className="font-semibold">{summary.byAccuracy.HIGH}</span>
                </div>
              )}
              {summary.byAccuracy.MEDIUM > 0 && (
                <div className="flex justify-between">
                  <span>MEDIUM:</span>
                  <span className="font-semibold">{summary.byAccuracy.MEDIUM}</span>
                </div>
              )}
              {summary.byAccuracy.LOW > 0 && (
                <div className="flex justify-between">
                  <span>LOW:</span>
                  <span className="font-semibold">{summary.byAccuracy.LOW}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {progress < 100 && !isCancelled && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <Loader className="w-4 h-4 animate-spin text-blue-600" />
            <span className="text-sm text-gray-600">Processing...</span>
          </div>
        )}

        {progress === 100 && !isCancelled && (
          <div className="flex items-center justify-center gap-2 mb-6 text-green-600">
            <CheckCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Geocoding Complete!</span>
          </div>
        )}

        {isCancelled && (
          <div className="flex items-center justify-center gap-2 mb-6 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm font-medium">Cancelled</span>
          </div>
        )}

        <div className="flex gap-3">
          {progress < 100 && (
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-medium transition"
            >
              Cancel
            </button>
          )}
          {(progress === 100 || isCancelled) && (
            <button
              onClick={() => progress === 100 && onComplete(results)}
              className="flex-1 px-4 py-2 bg-blue-800 text-white rounded hover:bg-blue-900 font-medium transition disabled:opacity-50"
              disabled={isCancelled}
            >
              {isCancelled ? 'Cancelled' : 'Continue'}
            </button>
          )}
        </div>
      </div>

      {showToast && (
        <div className="fixed bottom-4 right-4">
          <Toast
            type={showToast.type}
            message={showToast.message}
            title=""
            onClose={() => setShowToast(null)}
          />
        </div>
      )}
    </div>
  );
}
