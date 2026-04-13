import React, { useState } from 'react';
import { MapPin, Package, Phone, Navigation, GripVertical, MessageCircle, Truck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import SMSConfirmationModal from './SMSConfirmationModal';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import type { Delivery } from '../../types';

interface DeliveryCardProps {
  delivery: Delivery;
  /** Order number shown on the card (1-based). */
  displayIndex: number;
  /** Index in the full ordered list for drag-and-drop (omit when drag is disabled). */
  dragIndex?: number;
  /** When true, drag-and-drop is disabled (e.g. list is filtered). */
  dragDisabled?: boolean;
  onClick: () => void;
  onDragStart?: (index: number) => void;
  onDragOver?: (index: number) => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  onCloseDetailModal?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export default function DeliveryCard({
  delivery,
  displayIndex,
  dragIndex,
  dragDisabled = false,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragging,
  isDragOver,
  onCloseDetailModal,
  onMouseEnter,
  onMouseLeave,
}: DeliveryCardProps) {
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [markingOutForDelivery, setMarkingOutForDelivery] = useState(false);
  const updateDeliveryStatus = useDeliveryStore((state) => state.updateDeliveryStatus);
  const dynamicDistanceKm =
    typeof (delivery as Delivery & { distanceFromDriverKm?: number }).distanceFromDriverKm === 'number'
      ? (delivery as Delivery & { distanceFromDriverKm?: number }).distanceFromDriverKm
      : delivery.distanceFromWarehouse;
  // ETA: prefer explicit estimatedEta/eta fields (set by routing service), then
  // fall back to the store-calculated estimatedTime (based on stop sequence).
  const etaRaw = (delivery as Delivery & { estimatedEta?: string | null; eta?: string | null }).estimatedEta
    || (delivery as Delivery & { estimatedEta?: string | null; eta?: string | null }).eta
    || (delivery.estimatedTime instanceof Date ? delivery.estimatedTime.toISOString()
        : typeof delivery.estimatedTime === 'string' ? delivery.estimatedTime : null);
  const etaText = etaRaw
    ? (() => {
        const d = new Date(etaRaw);
        return isNaN(d.getTime()) ? 'N/A' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      })()
    : 'N/A';
  const dIdx = dragIndex ?? 0;
  const canDrag = !dragDisabled && typeof dragIndex === 'number';

  const handleSMSClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onCloseDetailModal) {
      onCloseDetailModal();
    }
    if (delivery.phone) {
      setTimeout(() => setShowSMSModal(true), 100);
    }
  };

  const handleMarkOutForDelivery = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (markingOutForDelivery) return;
    setMarkingOutForDelivery(true);
    try {
      const response = await api.put(`/deliveries/admin/${delivery.id}/status`, {
        status: 'out-for-delivery',
        customer: delivery.customer,
        address: delivery.address,
      });
      if (response.data?.ok) {
        updateDeliveryStatus(delivery.id as string, 'out-for-delivery');
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: { deliveryId: delivery.id, status: 'out-for-delivery', updatedAt: new Date() },
        }));
      }
    } catch (err) {
      console.error('[DeliveryCard] Failed to mark out for delivery:', err);
    } finally {
      setMarkingOutForDelivery(false);
    }
  };

  const handleCallClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (delivery.phone) {
      window.location.href = `tel:${String(delivery.phone).replace(/\s/g, '')}`;
    }
  };

  const isP1 = delivery.priority === 1;
  const canMarkOutForDelivery = ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(
    (delivery.status || '').toLowerCase(),
  );

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        if (e.dataTransfer) {
          try {
            e.dataTransfer.effectAllowed = 'move';
          } catch {
            /* ignore */
          }
        }
        onDragStart?.(dIdx);
      }}
      onDragOver={(e) => {
        if (!canDrag) return;
        e.preventDefault();
        onDragOver?.(dIdx);
      }}
      onDragLeave={(e) => {
        if (!canDrag) return;
        e.preventDefault();
        onDragLeave?.();
      }}
      onDrop={(e) => {
        if (!canDrag) return;
        e.preventDefault();
        onDrop?.();
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`flex flex-col rounded-lg border transition-all ${
        isP1
          ? 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-600'
          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/90'
      } ${
        canDrag ? 'cursor-move' : 'cursor-pointer'
      } ${
        isDragging
          ? 'opacity-50 border-blue-400 dark:border-blue-500 shadow-md'
          : isDragOver
            ? 'ring-2 ring-blue-400 dark:ring-blue-500 shadow-md scale-[1.01]'
            : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-2 p-3 sm:p-4">
        {canDrag && (
          <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
            <GripVertical className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 dark:text-gray-500" />
            <span className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400 w-6 text-center">
              {displayIndex + 1}.
            </span>
          </div>
        )}
        {!canDrag && (
          <span className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400 w-8 flex-shrink-0 pt-0.5">
            {displayIndex + 1}.
          </span>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100">
              {delivery.customer}
            </h3>
            <StatusBadge status={delivery.status} />
            {isP1 && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">
                P1
              </span>
            )}
            {!isP1 && delivery.priority != null && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100">
                P{delivery.priority}
              </span>
            )}
          </div>

          {(delivery.poNumber || delivery.metadata?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400 dark:text-gray-500">
              {delivery.poNumber && (
                <span>PO: <span className="font-mono text-gray-600 dark:text-gray-300">{String(delivery.poNumber)}</span></span>
              )}
              {((delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber) && (
                <span>Del: <span className="font-mono text-gray-600 dark:text-gray-300">{(delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber}</span></span>
              )}
            </div>
          )}

          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
            <span className="flex-shrink-0" aria-hidden>
              📍
            </span>
            <span className="break-words">{delivery.address}</span>
          </div>
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
            <span className="flex-shrink-0" aria-hidden>
              📦
            </span>
            <span className="break-words">{delivery.items}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Navigation className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {(dynamicDistanceKm ?? 0).toFixed(1)} km
              </span>
            </div>
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              ETA {etaText}
            </div>
            {delivery.phone && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCallClick}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600"
                  title="Call customer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Call
                </button>
                <button
                  type="button"
                  onClick={handleSMSClick}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white"
                  title="Send confirmation SMS"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  SMS
                </button>
              </div>
            )}
            {canMarkOutForDelivery && (
              <button
                type="button"
                onClick={(e) => { void handleMarkOutForDelivery(e); }}
                disabled={markingOutForDelivery}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                title="Manually mark as out for delivery"
              >
                <Truck className="w-3.5 h-3.5" />
                {markingOutForDelivery ? 'Updating…' : 'Out for Delivery'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showSMSModal && (
        <SMSConfirmationModal
          delivery={delivery}
          onClose={() => setShowSMSModal(false)}
          onSuccess={() => {
            setTimeout(() => setShowSMSModal(false), 2000);
          }}
        />
      )}
    </div>
  );
}
