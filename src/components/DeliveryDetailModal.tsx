import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { X, Camera, Signature, Loader, Upload, Trash2 } from 'lucide-react';
import api from '../frontend/apiClient';
import type { Delivery } from '../types';

const POD_REQUIRED_STATUSES = [
  'delivered',
  'delivered-without-installation',
  'delivered-with-installation',
];

interface PodUploadFile {
  file: File;
  preview: string;
  base64: string;
}

interface DeliveryDetailModalProps {
  delivery: (Delivery & Record<string, unknown>) | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdate?: (deliveryId: string, newStatus: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  delivered:
    'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700',
  pending:
    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
  cancelled:
    'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
  'out-for-delivery':
    'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  'delivered-without-installation':
    'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600',
};

const STATUS_OPTIONS = [
  'pending',
  'out-for-delivery',
  'delivered',
  'delivered-without-installation',
  'cancelled',
];

export default function DeliveryDetailModal({
  delivery,
  isOpen,
  onClose,
  onStatusUpdate,
}: DeliveryDetailModalProps) {
  const [newStatus, setNewStatus] = useState(delivery?.status ?? 'pending');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [podUploadFiles, setPodUploadFiles] = useState<PodUploadFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [podPhotos, setPodPhotos] = useState<string[]>([]);
  const [driverSignature, setDriverSignature] = useState<string | null>(null);
  const [customerSignature, setCustomerSignature] = useState<string | null>(null);
  const [podFetched, setPodFetched] = useState(false);
  const [podLoading, setPodLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (delivery && isOpen) {
      setNewStatus(delivery.status ?? 'pending');
      setPendingStatus(null);
      setPodUploadFiles([]);
      setError('');
      setSuccess('');
      setPodFetched(false);

      const photos = Array.isArray(delivery.photos) ? (delivery.photos as unknown[]) : [];
      const firstPhoto = photos[0];
      const firstPhotoData =
        typeof firstPhoto === 'string'
          ? firstPhoto
          : (firstPhoto as Record<string, unknown>)?.['data'] ?? null;

      if (firstPhotoData || delivery.driverSignature || delivery.customerSignature) {
        setPodPhotos(
          photos
            .map((p) =>
              typeof p === 'string' ? p : ((p as Record<string, unknown>)?.['data'] as string),
            )
            .filter(Boolean) as string[],
        );
        setDriverSignature((delivery.driverSignature as string) ?? null);
        setCustomerSignature((delivery.customerSignature as string) ?? null);
        setPodFetched(true);
      } else if (delivery.id || delivery['ID']) {
        setPodLoading(true);
        api
          .get(`/deliveries/${delivery.id ?? delivery['ID']}/pod`)
          .then((res) => {
            if (res.data?.ok && res.data?.pod) {
              const pod = res.data.pod as Record<string, unknown>;
              const photoList = Array.isArray(pod['photos'])
                ? (pod['photos'] as unknown[])
                    .map((p) =>
                      typeof p === 'string'
                        ? p
                        : ((p as Record<string, unknown>)?.['data'] as string),
                    )
                    .filter(Boolean) as string[]
                : [];
              setPodPhotos(photoList);
              setDriverSignature((pod['driverSignature'] as string) ?? null);
              setCustomerSignature((pod['customerSignature'] as string) ?? null);
            }
          })
          .catch(() => {})
          .finally(() => {
            setPodLoading(false);
            setPodFetched(true);
          });
      } else {
        setPodFetched(true);
      }
    }
  }, [delivery, isOpen]);

  useEffect(() => {
    if (!delivery || !isOpen || !podFetched) return;

    const currentStatus = (delivery.status ?? '').toLowerCase();
    const hasExistingPOD = (podPhotos && podPhotos.length > 0) || !!driverSignature || !!customerSignature;

    if (POD_REQUIRED_STATUSES.includes(currentStatus) && !hasExistingPOD && !pendingStatus) {
      setPendingStatus(currentStatus);
    }
  }, [delivery, isOpen, podFetched, podPhotos, driverSignature, customerSignature, pendingStatus]);

  const handleStatusChange = async (newStatusValue: string): Promise<void> => {
    if (POD_REQUIRED_STATUSES.includes(newStatusValue)) {
      setPendingStatus(newStatusValue);
      setPodUploadFiles([]);
      setError('');
      return;
    }
    await saveStatus(newStatusValue, []);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        setPodUploadFiles((prev) => [...prev, { file, preview: result, base64: result }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeUploadFile = (idx: number): void => {
    setPodUploadFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleConfirmWithPod = async (): Promise<void> => {
    if (podUploadFiles.length === 0) {
      setError('Please attach at least one POD photo before confirming.');
      return;
    }
    await saveStatus(
      pendingStatus ?? '',
      podUploadFiles.map((f) => f.base64),
    );
    setPendingStatus(null);
    setPodUploadFiles([]);
  };

  const saveStatus = async (statusValue: string, photoBase64Array: string[]): Promise<void> => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const body: Record<string, unknown> = { status: statusValue };
      if (photoBase64Array && photoBase64Array.length > 0) {
        body['photos'] = photoBase64Array;
      }
      const deliveryId = delivery?.id ?? (delivery?.['ID'] as string);
      const response = await api.put(`/deliveries/admin/${deliveryId}/status`, body);
      if (response.data.success || response.status === 200) {
        setNewStatus(statusValue);
        if (photoBase64Array && photoBase64Array.length > 0) {
          setPodPhotos((prev) => [...photoBase64Array, ...prev]);
        }
        setSuccess('Status updated successfully!');
        setTimeout(() => setSuccess(''), 3000);
        window.dispatchEvent(
          new CustomEvent('deliveryStatusUpdated', {
            detail: { deliveryId, newStatus: statusValue },
          }),
        );
        if (onStatusUpdate) onStatusUpdate(deliveryId ?? '', statusValue);
      } else {
        setError(
          (response.data as Record<string, unknown>)?.['message'] as string ||
            'Failed to update status',
        );
      }
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      setError(
        e.response?.data?.message ?? e.message ?? 'Error updating delivery status',
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !delivery) return null;

  const status = (delivery.status ?? 'pending').toLowerCase();
  const statusColorClass = STATUS_COLORS[status] ?? STATUS_COLORS['default'];
  void statusColorClass;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 9998, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 border-b border-blue-200 dark:border-blue-700 px-6 py-5 flex items-center justify-between rounded-t-lg">
          <h2 className="text-2xl font-bold text-white">Delivery Details</h2>
          <button onClick={onClose} className="text-white hover:text-blue-100 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-green-800 dark:text-green-300 font-medium">✓ {success}</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-300 font-medium">✕ {error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                PO Number
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-mono text-lg">
                {(delivery.poNumber as string) || (delivery['PONumber'] as string) || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Customer
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {delivery.customer ||
                  (delivery['Customer'] as string) ||
                  (delivery['customerName'] as string) ||
                  'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Driver
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {(delivery.driverName as string) || 'Unassigned'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Date
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {delivery.created_at || delivery.createdAt || delivery.created
                  ? new Date(
                      (delivery.created_at ||
                        delivery.createdAt ||
                        delivery.created) as string,
                    ).toLocaleString()
                  : 'N/A'}
              </p>
            </div>
          </div>

          {(delivery.address || delivery['deliveryAddress']) && (
            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                📍 Delivery Address
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.address || (delivery['deliveryAddress'] as string)}
              </p>
            </div>
          )}

          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-lg border border-blue-200 dark:border-blue-700">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <span>📦 Delivery Status</span>
              {loading && <Loader size={16} className="animate-spin text-blue-600" />}
            </label>

            <select
              value={pendingStatus ?? newStatus}
              onChange={(e) => void handleStatusChange(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/-/g, ' ')}
                </option>
              ))}
            </select>

            {pendingStatus && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <Camera size={16} />
                  <span>POD Photo Required — attach at least one image to confirm status change</span>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-amber-400 dark:border-amber-600 rounded-lg p-4 text-center cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                >
                  <Upload size={22} className="mx-auto mb-1 text-amber-500" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Click to select photos
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    JPG, PNG, WEBP (multiple allowed)
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />

                {podUploadFiles.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {podUploadFiles.map((f, idx) => (
                      <div
                        key={idx}
                        className="relative rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600"
                      >
                        <img
                          src={f.preview}
                          alt={`Upload ${idx + 1}`}
                          className="w-full h-24 object-cover"
                        />
                        <button
                          onClick={() => removeUploadFile(idx)}
                          className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => void handleConfirmWithPod()}
                    disabled={loading || podUploadFiles.length === 0}
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader size={16} className="animate-spin" /> : null}
                    ✓ Confirm — {pendingStatus.replace(/-/g, ' ')}
                  </button>
                  <button
                    onClick={() => {
                      setPendingStatus(null);
                      setPodUploadFiles([]);
                      setError('');
                    }}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {(podLoading ||
            podPhotos.length > 0 ||
            driverSignature ||
            customerSignature ||
            podFetched) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                <Signature size={20} className="text-blue-600" />
                Proof of Delivery
                {podLoading && <Loader size={18} className="animate-spin text-blue-600" />}
              </h3>

              {podLoading &&
                podPhotos.length === 0 &&
                !driverSignature &&
                !customerSignature && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading POD data...</p>
                )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {podPhotos.length > 0 && (
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Camera size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        POD Photos ({podPhotos.length})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {podPhotos.map((src, idx) => (
                        <div
                          key={idx}
                          className="relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600"
                        >
                          <img
                            src={src}
                            alt={`POD ${idx + 1}`}
                            className="w-full h-40 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3EImage not available%3C/text%3E%3C/svg%3E';
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {driverSignature && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Signature size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Driver Signature
                      </span>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
                      <img
                        src={driverSignature}
                        alt="Driver signature"
                        className="w-full h-auto max-h-48 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"%3E%3Crect fill="%23e5e7eb" width="400" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3ESignature not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}

                {customerSignature && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Signature size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Customer Signature
                      </span>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
                      <img
                        src={customerSignature}
                        alt="Customer signature"
                        className="w-full h-auto max-h-48 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"%3E%3Crect fill="%23e5e7eb" width="400" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3ESignature not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {!podLoading &&
                podPhotos.length === 0 &&
                !driverSignature &&
                !customerSignature && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    No POD uploaded yet.
                  </p>
                )}
            </div>
          )}

          {(delivery.notes || delivery['specialInstructions']) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📝 Notes
              </label>
              <p className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700/30 p-3 rounded border border-gray-200 dark:border-gray-700">
                {(delivery.notes as string) || (delivery['specialInstructions'] as string)}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end rounded-b-lg">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-primary-800 hover:bg-primary-900 dark:bg-primary-700 dark:hover:bg-primary-900 text-white font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  if (!isOpen || !delivery) return null;
  return ReactDOM.createPortal(modalContent, document.body);
}
