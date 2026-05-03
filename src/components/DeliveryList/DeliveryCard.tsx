import React, { useState } from 'react';
import { MapPin, Package, Phone, Navigation, GripVertical, MessageCircle, Truck, BellRing, CheckCircle2, Clock, Camera, FileSignature, CalendarClock, XCircle, ImageOff } from 'lucide-react';
import StatusBadge from './StatusBadge';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import { getEtaStatus } from '../../utils/deliveryListFilter';
import { computeETD, formatEtdLabel } from '../../utils/etd';
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
  const [markingOutForDelivery, setMarkingOutForDelivery] = useState(false);
  const [notifyingArrival, setNotifyingArrival] = useState(false);
  // Local shadow of metadata.arrivalNotifiedAt — persists instantly after click
  // even before the store syncs. Server is source of truth on next fetch.
  const initialArrivalAt = ((delivery.metadata as { arrivalNotifiedAt?: string } | null | undefined)?.arrivalNotifiedAt) || null;
  const [arrivalNotifiedAt, setArrivalNotifiedAt] = useState<string | null>(initialArrivalAt);
  const updateDeliveryStatus = useDeliveryStore((state) => state.updateDeliveryStatus);
  const dynamicDistanceKm =
    typeof (delivery as Delivery & { distanceFromDriverKm?: number }).distanceFromDriverKm === 'number'
      ? (delivery as Delivery & { distanceFromDriverKm?: number }).distanceFromDriverKm
      : delivery.distanceFromWarehouse;
  // Dynamic ETA: live GPS + routing engine estimate
  const etaRaw = (delivery as Delivery & { estimatedEta?: string | null; eta?: string | null }).estimatedEta
    || (delivery as Delivery & { estimatedEta?: string | null; eta?: string | null }).eta
    || (delivery.estimatedTime instanceof Date ? delivery.estimatedTime.toISOString()
        : typeof delivery.estimatedTime === 'string' ? delivery.estimatedTime : null);
  const fmtTime = (iso: string | null | undefined): string => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? 'N/A' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  /**
   * Relative Dubai-day label ("Today" / "Tomorrow" / "Wed 25 Apr"). Prefixed
   * to every ETA chip so a driver can't mistake an evening route time for
   * the next morning, or a tomorrow-scheduled order for a today one.
   * Returns empty string if ISO missing/invalid so the chip falls back to
   * time-only rather than rendering "N/A, 10:20".
   */
  const fmtDateLabel = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dubaiDayStr = (v: Date): string => {
      const z = new Date(v.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
      return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
    };
    const today = dubaiDayStr(new Date());
    const tomorrowDt = new Date();
    tomorrowDt.setDate(tomorrowDt.getDate() + 1);
    const tomorrow = dubaiDayStr(tomorrowDt);
    const target = dubaiDayStr(d);
    if (target === today) return 'Today';
    if (target === tomorrow) return 'Tomorrow';
    return d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Dubai',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };
  const fmtDateTime = (iso: string | null | undefined): string => {
    const time = fmtTime(iso);
    if (time === 'N/A') return 'N/A';
    const date = fmtDateLabel(iso);
    return date ? `${date}, ${time}` : time;
  };
  const etaText = fmtDateTime(etaRaw);

  // Planned ETA: 8 AM dispatch baseline; Static ETA: locked at Start Delivery
  const plannedEtaRaw = (delivery as Delivery & { plannedEta?: string | null }).plannedEta ?? null;
  const staticEtaRaw = (delivery as Delivery & { staticEta?: string | null }).staticEta ?? null;
  const planEtaRaw = staticEtaRaw ?? plannedEtaRaw;
  const planEtaText = fmtDateTime(planEtaRaw);

  // D3: Delay detection — use plan ETA if available, else fall back to getEtaStatus
  const etaStatus: 'on_time' | 'delayed' | 'unknown' = (() => {
    if (planEtaRaw && etaRaw) {
      const diff = new Date(etaRaw).getTime() - new Date(planEtaRaw).getTime();
      if (diff > 60 * 60 * 1000) return 'delayed'; // >1hr over static ETA
      if (diff >= 0) return 'on_time';
      return 'unknown';
    }
    return getEtaStatus(delivery);
  })();
  const dIdx = dragIndex ?? 0;
  const canDrag = !dragDisabled && typeof dragIndex === 'number';

  const handleSMSClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (onCloseDetailModal) onCloseDetailModal();
    if (!delivery.phone || !delivery.id) return;
    try {
      await api.post(
        `/deliveries/${encodeURIComponent(String(delivery.id))}/send-sms`, {}
      );
    } catch {
      // silent — no popup or message shown
    }
  };

  const handleMarkOutForDelivery = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (markingOutForDelivery) return;
    setMarkingOutForDelivery(true);
    try {
      // New flow: admin can no longer jump straight to out-for-delivery. This
      // quick-action now posts goods issue (pgi-done) by setting a GMD if one
      // is missing; the driver then picks + starts the delivery themselves.
      const existingGmd = (delivery as unknown as { goodsMovementDate?: string | Date | null })
        .goodsMovementDate;
      const gmdIso = existingGmd
        ? new Date(existingGmd as string).toISOString()
        : new Date().toISOString();
      const response = await api.put(`/deliveries/admin/${delivery.id}/status`, {
        status: 'pgi-done',
        goodsMovementDate: gmdIso,
        customer: delivery.customer,
        address: delivery.address,
      });
      if (response.data?.ok) {
        updateDeliveryStatus(delivery.id as string, 'pgi-done');
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: { deliveryId: delivery.id, status: 'pgi-done', updatedAt: new Date() },
        }));
      }
    } catch (err) {
      console.error('[DeliveryCard] Failed to mark PGI done:', err);
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

  /**
   * "Arrived" button — tells the customer the driver is pulling up now.
   * Hits POST /deliveries/:id/notify-arrival which is idempotent on the
   * server side (metadata.arrivalNotifiedAt), so double-tapping is safe.
   */
  const handleNotifyArrival = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (notifyingArrival || arrivalNotifiedAt || !delivery.id) return;
    setNotifyingArrival(true);
    try {
      const response = await api.post(
        `/deliveries/${encodeURIComponent(String(delivery.id))}/notify-arrival`,
        { trigger: 'manual' },
      );
      const data = response.data as { ok?: boolean; arrivalNotifiedAt?: string };
      if (data?.ok && data.arrivalNotifiedAt) {
        setArrivalNotifiedAt(data.arrivalNotifiedAt);
        // Keep store in sync so refresh still reflects the "notified" state
        updateDeliveryStatus(delivery.id as string, (delivery.status || '').toString(), {
          metadata: {
            ...((delivery.metadata as Record<string, unknown>) || {}),
            arrivalNotifiedAt: data.arrivalNotifiedAt,
            arrivalNotifiedTrigger: 'manual',
          } as Delivery['metadata'],
        });
      }
    } catch (err) {
      console.error('[DeliveryCard] notify-arrival failed:', err);
    } finally {
      setNotifyingArrival(false);
    }
  };

  // Priority is a business decision owned by Delivery Team / Admin, stored in metadata.isPriority.
  // The numeric `priority` (1/2/3) is distance-based routing data and must NOT drive the Priority badge.
  const showPriority = (delivery as unknown as { metadata?: { isPriority?: boolean } }).metadata?.isPriority === true;
  const canMarkOutForDelivery = ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(
    (delivery.status || '').toLowerCase(),
  );
  // "Arrived" is relevant while the driver is actively delivering
  const isOnRoad = ['out-for-delivery', 'in-transit', 'in-progress'].includes(
    (delivery.status || '').toLowerCase(),
  );
  const canNotifyArrival = isOnRoad && !!delivery.phone && !arrivalNotifiedAt;

  // ── Completed card detection ──────────────────────────────────────────────
  const statusLower = (delivery.status || '').toLowerCase();
  const DELIVERED_STATUSES = new Set([
    'delivered', 'delivered-with-installation', 'delivered-without-installation',
    'completed', 'pod-completed', 'finished',
  ]);
  const isDelivered = DELIVERED_STATUSES.has(statusLower);
  const isCancelled = statusLower === 'cancelled' || statusLower === 'canceled' || statusLower === 'rejected';
  const isRescheduled = statusLower === 'rescheduled';
  const isCompletedCard = isDelivered || isCancelled || isRescheduled;

  // Metadata helpers for completed report
  const meta = (delivery.metadata || {}) as Record<string, unknown>;
  const deliveredAtRaw = delivery.deliveredAt ?? delivery.podCompletedAt ?? null;
  const deliveredAtStr = deliveredAtRaw ? fmtDateTime(typeof deliveredAtRaw === 'string' ? deliveredAtRaw : (deliveredAtRaw as Date).toISOString()) : null;
  const hasPhotos = Array.isArray(delivery.photos) && delivery.photos.length > 0;
  const hasSignature = !!delivery.driverSignature || !!delivery.customerSignature;
  const hasPod = delivery.hasPod || hasPhotos || hasSignature;
  const podNotes = delivery.deliveryNotes || delivery.conditionNotes || null;
  const cancelNotes = isCancelled ? (delivery.deliveryNotes || delivery.conditionNotes || (meta.cancelReason as string | null) || null) : null;
  const rescheduleReason = isRescheduled ? ((meta.rescheduleReason as string | null) || null) : null;
  const rescheduledAtRaw = isRescheduled ? ((meta.rescheduledAt as string | null) || null) : null;
  const confirmedDateRaw = delivery.confirmedDeliveryDate ?? null;
  const rescheduledDateStr = confirmedDateRaw
    ? new Date(typeof confirmedDateRaw === 'string' ? confirmedDateRaw : (confirmedDateRaw as Date).toISOString()).toLocaleDateString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : null;

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
        showPriority
          ? 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-600'
          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/90'
      } ${
        isCompletedCard ? 'cursor-default' : canDrag ? 'cursor-move' : 'cursor-pointer'
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
            {showPriority && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">
                🚨 Priority
              </span>
            )}
            {(() => {
              // ETD chip — visible only after the driver confirms picking.
              // Anchors at max(deliveryDay@08:00, picking.confirmedAt) so urgent
              // same-day pickups display the actual departure time, while
              // non-urgent rows show the morning baseline.
              const etd = computeETD(delivery);
              if (!etd) return null;
              return (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
                  title="Departure from warehouse (driver pickup-confirmed). Standard orders dispatch at 08:00 Dubai; urgent same-day orders depart at the picking-confirm moment."
                >
                  <Clock className="w-3 h-3" />
                  {formatEtdLabel(etd)}
                </span>
              );
            })()}
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

          {/* ── Completed card: delivery report ── */}
          {isCompletedCard && (
            <div className="pt-1.5 space-y-2">
              {/* Delivered report */}
              {isDelivered && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold">
                      Delivered{deliveredAtStr ? ` — ${deliveredAtStr}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasPod && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700">
                        <FileSignature className="w-3 h-3" />
                        POD Captured
                      </span>
                    )}
                    {hasPhotos && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                        <Camera className="w-3 h-3" />
                        {delivery.photos!.length} Photo{delivery.photos!.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {hasSignature && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                        <FileSignature className="w-3 h-3" />
                        Signature
                      </span>
                    )}
                    {!hasPod && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
                        <ImageOff className="w-3 h-3" />
                        No POD
                      </span>
                    )}
                  </div>
                  {podNotes && (
                    <p className="text-[11px] text-green-600 dark:text-green-400 italic leading-tight">
                      {podNotes}
                    </p>
                  )}
                </div>
              )}

              {/* Cancelled report */}
              {isCancelled && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold">
                      {statusLower === 'rejected' ? 'Rejected' : 'Cancelled'}
                    </span>
                  </div>
                  {cancelNotes ? (
                    <p className="text-[11px] text-red-600 dark:text-red-400 leading-tight">
                      <span className="font-semibold">Reason:</span> {cancelNotes}
                    </p>
                  ) : (
                    <p className="text-[11px] text-red-400 dark:text-red-500 italic leading-tight">
                      No reason provided
                    </p>
                  )}
                </div>
              )}

              {/* Rescheduled report */}
              {isRescheduled && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <CalendarClock className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs sm:text-sm font-semibold">
                      Rescheduled{rescheduledDateStr ? ` — ${rescheduledDateStr}` : ''}
                    </span>
                  </div>
                  {rescheduleReason && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">
                      <span className="font-semibold">Reason:</span> {rescheduleReason}
                    </p>
                  )}
                  {rescheduledAtRaw && (
                    <p className="text-[10px] text-amber-500 dark:text-amber-500 leading-tight">
                      Rescheduled on {fmtDateTime(rescheduledAtRaw)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Active card: ETA, distance, actions ── */}
          {!isCompletedCard && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Navigation className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {(dynamicDistanceKm ?? 0).toFixed(1)} km
              </span>
            </div>
            {/* Planned ETA — based on 8 AM dispatch or locked at Start Delivery */}
            {planEtaRaw && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                📅 Plan {planEtaText}
              </div>
            )}
            {/* Dynamic ETA — live GPS estimate */}
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              ⏱ ETA {etaText}
            </div>
            {etaStatus === 'on_time' && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                ✓ On Time
              </div>
            )}
            {etaStatus === 'delayed' && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                ⚠ Order Delay
              </div>
            )}
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
                  onClick={(e) => { void handleSMSClick(e); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white"
                  title="Send SMS confirmation"
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
                title="Post goods issue — moves order into the driver's Picking List"
              >
                <Truck className="w-3.5 h-3.5" />
                {markingOutForDelivery ? 'Updating…' : 'Mark PGI Done'}
              </button>
            )}
            {canNotifyArrival && (
              <button
                type="button"
                onClick={(e) => { void handleNotifyArrival(e); }}
                disabled={notifyingArrival}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                title="Send 'arriving now' SMS to customer"
              >
                <BellRing className="w-3.5 h-3.5" />
                {notifyingArrival ? 'Notifying…' : 'Arrived'}
              </button>
            )}
            {arrivalNotifiedAt && isOnRoad && (
              <div
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-700"
                title={`Arrival SMS sent ${new Date(arrivalNotifiedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Customer Notified
              </div>
            )}
          </div>
          )}
        </div>
      </div>

    </div>
  );
}
