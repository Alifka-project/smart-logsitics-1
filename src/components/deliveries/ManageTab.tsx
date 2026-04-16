import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FileUpload, { type FileUploadHandle } from '../Upload/FileUpload';
import useDeliveryStore from '../../store/useDeliveryStore';
import { generateFileHash } from '../../utils/fileHash';
import { deliveryToManageOrder, workflowToApiPatch } from '../../utils/deliveryWorkflowMap';
import type { DeliveryStatus } from '../../types/delivery';
import type { Delivery } from '../../types';
import api from '../../frontend/apiClient';
import { excludeTeamPortalGarbageDeliveries } from '../../utils/deliveryListFilter';
import { StatusMetricCards } from './StatusMetricCards';
import { OrdersTable, type OrdersTableTab } from './OrdersTable';
import { ManageSidebar } from './ManageSidebar';
import { OrderEditModal } from './OrderEditModal';

interface ManageTabProps {
  /** When true (embedded in team portals), tighter padding and gaps below sub-tabs */
  compactVerticalSpacing?: boolean;
  /** When true (team portals), hide bad import rows from metrics and Orders table */
  excludeGarbageDeliveries?: boolean;
  /** When true (logistics_team role), hide the file upload dropzone entirely */
  hideUpload?: boolean;
  onSwitchToDeliveriesTab: () => void;
  onUploadSuccess: (result: { count: number; warnings?: string[]; fileHash?: string }) => void;
  onUploadError: (result: { errors?: string[] }) => void;
  onDuplicateFile: () => void;
  onToastError: (message: string) => void;
  onNotifySuccess: (title: string, message?: string) => void;
  onExportDeliveries: () => void;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function downloadTemplateCsv(): void {
  const headers = 'customer,address,lat,lng,items,phone\n';
  const sample = 'Sample Customer,Dubai Marina,25.0800,55.1400,Refrigerator ERG123,+971500000000\n';
  const blob = new Blob([headers + sample], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'electrolux-delivery-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ManageTab({
  compactVerticalSpacing = false,
  excludeGarbageDeliveries = false,
  hideUpload = false,
  onSwitchToDeliveriesTab,
  onUploadSuccess,
  onUploadError,
  onDuplicateFile,
  onToastError,
  onNotifySuccess,
  onExportDeliveries,
}: ManageTabProps) {
  const fileUploadRef = useRef<FileUploadHandle>(null);
  const pendingHashes = useRef<Set<string>>(new Set());

  const deliveries = useDeliveryStore((s) => s.deliveries ?? []);
  const visibleDeliveries = useMemo(
    () => (excludeGarbageDeliveries ? excludeTeamPortalGarbageDeliveries(deliveries) : deliveries),
    [deliveries, excludeGarbageDeliveries],
  );
  const recentUploads = useDeliveryStore((s) => s.recentUploads ?? []);
  const isFileAlreadyUploaded = useDeliveryStore((s) => s.isFileAlreadyUploaded);
  const updateDeliveryStatus = useDeliveryStore((s) => s.updateDeliveryStatus);
  const setDeliveryListFilter = useDeliveryStore((s) => s.setDeliveryListFilter);
  const manageTabFilter = useDeliveryStore((s) => s.manageTabFilter);
  const setManageTabFilter = useDeliveryStore((s) => s.setManageTabFilter);

  const [tableTab, setTableTab] = useState<OrdersTableTab>('all');
  const [activeCardKey, setActiveCardKey] = useState<string | undefined>(undefined);

  // Apply incoming filter from Needs Attention cards then clear it
  useEffect(() => {
    if (manageTabFilter) {
      setTableTab(manageTabFilter as OrdersTableTab);
      setManageTabFilter(null);
    }
  }, [manageTabFilter, setManageTabFilter]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [isUploading, setIsUploading] = useState(false);
  const [drivers, setDrivers] = useState<{ id: string; fullName?: string | null; username: string }[]>([]);

  // Fetch driver list for the Assign Driver action in the orders table
  useEffect(() => {
    api.get('/admin/users?role=driver').then((res) => {
      const users = (res.data?.users ?? []) as { id: string; fullName?: string | null; username: string }[];
      setDrivers(users);
    }).catch(() => {});
  }, []);
  const [editDeliveryId, setEditDeliveryId] = useState<string | null>(null);
  const ordersTableRef = useRef<HTMLDivElement | null>(null);

  const manageOrders = useMemo(
    () => visibleDeliveries.map((d) => deliveryToManageOrder(d)),
    [visibleDeliveries],
  );

  const editingDelivery = useMemo(
    (): Delivery | null =>
      editDeliveryId ? (deliveries.find((d) => d.id === editDeliveryId) ?? null) : null,
    [deliveries, editDeliveryId],
  );

  const handleOrderEditSaved = useCallback(
    (updated: { status: string; notes?: string; scheduledDateIso?: string; goodsMovementDate?: string }) => {
      if (!editDeliveryId) return;
      const raw = deliveries.find((d) => d.id === editDeliveryId);
      if (!raw) return;
      const meta: Record<string, unknown> = { ...((raw.metadata as Record<string, unknown>) || {}) };
      if (updated.scheduledDateIso) meta.scheduledDate = updated.scheduledDateIso;
      updateDeliveryStatus(editDeliveryId, updated.status, {
        metadata: meta as Delivery['metadata'],
        deliveryNotes: updated.notes !== undefined ? updated.notes : raw.deliveryNotes ?? undefined,
        conditionNotes: updated.notes !== undefined ? updated.notes : raw.conditionNotes ?? undefined,
        ...(updated.goodsMovementDate ? { goodsMovementDate: updated.goodsMovementDate } : {}),
      });
      setEditDeliveryId(null);
      onNotifySuccess('Order updated', 'Changes saved.');
      window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
        detail: { deliveryId: editDeliveryId, status: updated.status, updatedAt: new Date() },
      }));
    },
    [editDeliveryId, deliveries, updateDeliveryStatus, onNotifySuccess],
  );

  const todayStats = useMemo(() => {
    const t0 = startOfToday();
    const uploads = recentUploads.filter((u) => new Date(u.uploadedAt) >= t0).length;
    const driverIds = new Set(
      visibleDeliveries.map((d) => d.assignedDriverId).filter((id): id is string => Boolean(id)),
    );
    const delivered = visibleDeliveries.filter((d) => {
      const s = (d.status || '').toLowerCase();
      return ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'finished', 'completed', 'pod-completed'].includes(s);
    }).length;
    return {
      uploads,
      totalOrders: visibleDeliveries.length,
      activeDrivers: driverIds.size,
      delivered,
    };
  }, [visibleDeliveries, recentUploads]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        const hash = await generateFileHash(file);
        if (isFileAlreadyUploaded(hash)) {
          onDuplicateFile();
          return;
        }
        if (pendingHashes.current.has(hash)) {
          onToastError('This file is already being processed.');
          return;
        }
        pendingHashes.current.add(hash);
        window.setTimeout(() => pendingHashes.current.delete(hash), 15_000);
        setIsUploading(true);
        fileUploadRef.current?.processFile(file, { fileHash: hash });
      } catch {
        onToastError('Could not read file. Try again.');
      }
    },
    [isFileAlreadyUploaded, onDuplicateFile, onToastError],
  );

  const handleStatusChange = useCallback(
    (orderId: string, newStatus: DeliveryStatus, scheduledDate?: Date) => {
      const raw = deliveries.find((d) => d.id === orderId);
      if (!raw) {
        onToastError('Order not found.');
        return;
      }
      const { apiStatus, updateData } = workflowToApiPatch(raw, newStatus, scheduledDate);
      // Persist to the server and update local store
      api
        .put(`/deliveries/admin/${orderId}/status`, {
          status: apiStatus,
          customer: raw.customer ?? undefined,
          address: raw.address ?? undefined,
        })
        .then(() => {
          updateDeliveryStatus(orderId, apiStatus, updateData);
          onNotifySuccess('Order updated', 'Status saved.');
          window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
            detail: { deliveryId: orderId, status: apiStatus, updatedAt: new Date() },
          }));
        })
        .catch((e: unknown) => {
          const err = e as { response?: { data?: { error?: string } }; message?: string };
          onToastError(err?.response?.data?.error ?? err?.message ?? 'Failed to update status');
        });
    },
    [deliveries, updateDeliveryStatus, onNotifySuccess, onToastError],
  );

  const handleMarkOutForDelivery = useCallback(
    async (orderId: string): Promise<void> => {
      const raw = deliveries.find((d) => d.id === orderId);
      if (!raw) { onToastError('Order not found.'); return; }
      try {
        await api.put(`/deliveries/admin/${orderId}/status`, {
          status: 'out-for-delivery',
          customer: raw.customer ?? undefined,
          address: raw.address ?? undefined,
          goodsMovementDate: (raw as unknown as { goodsMovementDate?: string }).goodsMovementDate || new Date().toISOString(),
        });
        updateDeliveryStatus(orderId, 'out-for-delivery');
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: { deliveryId: orderId, status: 'out-for-delivery', updatedAt: new Date() },
        }));
        onNotifySuccess('Dispatched', 'Delivery marked as out for delivery.');
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        onToastError(err?.response?.data?.error ?? err?.message ?? 'Failed to dispatch delivery');
      }
    },
    [deliveries, updateDeliveryStatus, onNotifySuccess, onToastError],
  );

  const sendSmsForDelivery = useCallback(
    async (deliveryId: string): Promise<{ whatsappUrl?: string } | null> => {
      try {
        const res = await api.post(`/deliveries/${encodeURIComponent(deliveryId)}/send-sms`, {});
        return res.data as { whatsappUrl?: string };
      } catch {
        return null;
      }
    },
    [],
  );

  const handleResendSMS = useCallback(
    async (orderId: string) => {
      const data = await sendSmsForDelivery(orderId);
      if (data?.whatsappUrl) window.open(data.whatsappUrl, '_blank');
    },
    [sendSmsForDelivery],
  );

  const handleAdminReschedule = useCallback(
    async (orderId: string, newDate: Date, reason: string) => {
      try {
        // Extract the Dubai-timezone calendar date (YYYY-MM-DD) so early-morning
        // UTC offsets don't shift the date one day backwards (e.g. 01:00 Dubai =
        // 21:00 UTC previous day → toISOString() would give the wrong date).
        const dubaiIsoDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Dubai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(newDate);
        const response = await api.put(`/deliveries/admin/${orderId}/reschedule`, {
          newDeliveryDate: dubaiIsoDate,
          reason,
        });
        updateDeliveryStatus(orderId, 'scheduled-confirmed');
        const rescheduleData = response.data as { whatsappUrl?: string };
        if (rescheduleData?.whatsappUrl) {
          window.open(rescheduleData.whatsappUrl, '_blank', 'noopener,noreferrer');
        }
        onNotifySuccess('Delivery rescheduled', 'Customer has been notified.');
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: { deliveryId: orderId, status: 'scheduled-confirmed', updatedAt: new Date() },
        }));
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        onToastError(err?.response?.data?.error ?? err?.message ?? 'Failed to reschedule delivery');
      }
    },
    [updateDeliveryStatus, onNotifySuccess, onToastError],
  );

  const handleBulkResendUnconfirmed = useCallback(async () => {
    const ids = manageOrders.filter((o) => o.status === 'unconfirmed').map((o) => o.id);
    if (ids.length === 0) return;
    for (const id of ids) {
      await sendSmsForDelivery(id);
    }
  }, [manageOrders, sendSmsForDelivery]);

  const handleCallCustomer = useCallback((phone: string) => {
    const p = phone.replace(/\s/g, '');
    if (!p || p === '—') return;
    window.location.href = `tel:${p}`;
  }, []);

  const handleWhatsApp = useCallback((phone: string) => {
    const clean = phone.replace(/\D/g, '');
    if (!clean) return;
    window.open(`https://wa.me/${clean}`, '_blank', 'noopener,noreferrer');
  }, []);

  const handleTableTabChange = useCallback((tab: OrdersTableTab) => {
    setTableTab(tab);
    setActiveCardKey(undefined);
  }, []);

  // Map StatusMetricCard status key → OrdersTableTab, then scroll to the table
  const handleCardClick = useCallback((statusKey: string) => {
    const tabMap: Record<string, OrdersTableTab> = {
      uploaded:         'pending',
      sms_sent:         'awaiting_customer',
      unconfirmed:      'awaiting_customer',
      next_shipment:    'next_shipment',
      future_schedule:  'future_schedule',
      out_for_delivery: 'out_for_delivery',
      order_delay:      'order_delay',
      rescheduled:      'rescheduled',
      delivered:        'delivered',
    };
    const tab = tabMap[statusKey] ?? 'all';
    setTableTab(tab);
    setActiveCardKey(statusKey);
    // Slight delay so the tab state settles before scrolling
    setTimeout(() => {
      ordersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const handleAssignDriver = useCallback(
    async (orderId: string, driverId: string) => {
      try {
        await api.put(`/deliveries/admin/${orderId}/assign`, { driverId });
        onNotifySuccess('Driver assigned', 'Driver successfully assigned to this delivery.');
        window.dispatchEvent(new CustomEvent('deliveriesUpdated'));
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        onToastError(err?.response?.data?.error ?? err?.message ?? 'Failed to assign driver');
      }
    },
    [onNotifySuccess, onToastError],
  );

  const handleTrackDelivery = useCallback(() => {
    onSwitchToDeliveriesTab();
  }, [onSwitchToDeliveriesTab]);

  const handleAssignConfirmed = useCallback(() => {
    setDeliveryListFilter('confirmed');
    onSwitchToDeliveriesTab();
  }, [setDeliveryListFilter, onSwitchToDeliveriesTab]);

  return (
    <div
      className={
        compactVerticalSpacing
          ? 'mx-auto w-full min-h-0 max-w-[1600px] rounded-xl bg-gray-50 px-3 pb-4 pt-2 dark:bg-gray-900/20 lg:px-4 lg:pb-5 lg:pt-3'
          : 'mx-auto w-full min-h-0 max-w-[1600px] rounded-xl bg-gray-50 p-4 dark:bg-gray-900/20 lg:p-6'
      }
    >
      <FileUpload
        ref={fileUploadRef}
        hideDefaultUI
        skipNavigate
        onSuccess={(p) => {
          setIsUploading(false);
          onUploadSuccess({
            count: p.count,
            warnings: p.warnings,
            fileHash: p.fileHash,
          });
        }}
        onError={(e) => {
          setIsUploading(false);
          onUploadError({ errors: e.errors });
        }}
      />

      <div className={compactVerticalSpacing ? 'mb-4' : 'mb-6'}>
        <StatusMetricCards
          orders={manageOrders}
          onCardClick={handleCardClick}
          activeKey={activeCardKey}
        />
      </div>

      <div className="manage-delivery-layout grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:grid-cols-[minmax(0,1fr)_320px]">
        <div ref={ordersTableRef} className="min-w-0">
          <OrdersTable
            orders={manageOrders}
            tableTab={tableTab}
            onTableTabChange={handleTableTabChange}
            onStatusChange={handleStatusChange}
            onAdminReschedule={(id, d, r) => void handleAdminReschedule(id, d, r)}
            onResendSMS={(id) => void handleResendSMS(id)}
            onCallCustomer={handleCallCustomer}
            onWhatsApp={handleWhatsApp}
            onTrackDelivery={() => handleTrackDelivery()}
            onEditOrder={(id) => setEditDeliveryId(id)}
            onMarkOutForDelivery={handleMarkOutForDelivery}
            onExport={onExportDeliveries}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortBy={sortBy}
            onSortChange={setSortBy}
            drivers={drivers}
            onAssignDriver={(id, dId) => void handleAssignDriver(id, dId)}
          />
        </div>
        <div className="min-w-0 w-full lg:sticky lg:top-4 lg:self-start">
          <ManageSidebar
            orders={manageOrders}
            onFileUpload={(f) => void handleFileUpload(f)}
            onDownloadTemplate={downloadTemplateCsv}
            onAssignConfirmed={handleAssignConfirmed}
            onBulkResendUnconfirmed={() => void handleBulkResendUnconfirmed()}
            isUploading={isUploading}
            todayStats={todayStats}
            hideUpload={hideUpload}
          />
        </div>
      </div>

      {editingDelivery && (
        <OrderEditModal
          delivery={editingDelivery}
          onClose={() => setEditDeliveryId(null)}
          onSaved={handleOrderEditSaved}
          onToastError={onToastError}
        />
      )}
    </div>
  );
}
