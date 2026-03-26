import React, { useCallback, useMemo, useRef, useState } from 'react';
import FileUpload, { type FileUploadHandle } from '../Upload/FileUpload';
import useDeliveryStore from '../../store/useDeliveryStore';
import { generateFileHash } from '../../utils/fileHash';
import { deliveryToManageOrder, workflowToApiPatch } from '../../utils/deliveryWorkflowMap';
import type { DeliveryStatus } from '../../types/delivery';
import type { Delivery } from '../../types';
import api from '../../frontend/apiClient';
import { StatusMetricCards } from './StatusMetricCards';
import { OrdersTable, type OrdersTableTab } from './OrdersTable';
import { ManageSidebar } from './ManageSidebar';
import { OrderEditModal } from './OrderEditModal';

interface ManageTabProps {
  onSwitchToDeliveriesTab: () => void;
  onUploadSuccess: (result: { count: number; warnings?: string[]; fileHash?: string }) => void;
  onUploadError: (result: { errors?: string[] }) => void;
  onDuplicateFile: () => void;
  onToastError: (message: string) => void;
  onNotifySuccess: (title: string, message?: string) => void;
  onReloadFromDatabase: () => void | Promise<void>;
  onExportDeliveries: () => void;
  isReloadingDatabase?: boolean;
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
  onSwitchToDeliveriesTab,
  onUploadSuccess,
  onUploadError,
  onDuplicateFile,
  onToastError,
  onNotifySuccess,
  onReloadFromDatabase,
  onExportDeliveries,
  isReloadingDatabase = false,
}: ManageTabProps) {
  const fileUploadRef = useRef<FileUploadHandle>(null);
  const pendingHashes = useRef<Set<string>>(new Set());

  const deliveries = useDeliveryStore((s) => s.deliveries ?? []);
  const recentUploads = useDeliveryStore((s) => s.recentUploads ?? []);
  const isFileAlreadyUploaded = useDeliveryStore((s) => s.isFileAlreadyUploaded);
  const updateDeliveryStatus = useDeliveryStore((s) => s.updateDeliveryStatus);
  const setDeliveryListFilter = useDeliveryStore((s) => s.setDeliveryListFilter);

  const [tableTab, setTableTab] = useState<OrdersTableTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [isUploading, setIsUploading] = useState(false);
  const [editDeliveryId, setEditDeliveryId] = useState<string | null>(null);

  const manageOrders = useMemo(() => deliveries.map((d) => deliveryToManageOrder(d)), [deliveries]);

  const editingDelivery = useMemo(
    (): Delivery | null =>
      editDeliveryId ? (deliveries.find((d) => d.id === editDeliveryId) ?? null) : null,
    [deliveries, editDeliveryId],
  );

  const handleOrderEditSaved = useCallback(
    (updated: { status: string; notes?: string; scheduledDateIso?: string }) => {
      if (!editDeliveryId) return;
      const raw = deliveries.find((d) => d.id === editDeliveryId);
      if (!raw) return;
      const meta: Record<string, unknown> = { ...((raw.metadata as Record<string, unknown>) || {}) };
      if (updated.scheduledDateIso) meta.scheduledDate = updated.scheduledDateIso;
      updateDeliveryStatus(editDeliveryId, updated.status, {
        metadata: meta as Delivery['metadata'],
        deliveryNotes: updated.notes !== undefined ? updated.notes : raw.deliveryNotes ?? undefined,
        conditionNotes: updated.notes !== undefined ? updated.notes : raw.conditionNotes ?? undefined,
      });
      setEditDeliveryId(null);
      onNotifySuccess('Order updated', 'Changes saved.');
    },
    [editDeliveryId, deliveries, updateDeliveryStatus, onNotifySuccess],
  );

  const todayStats = useMemo(() => {
    const t0 = startOfToday();
    const uploads = recentUploads.filter((u) => new Date(u.uploadedAt) >= t0).length;
    const driverIds = new Set(
      deliveries.map((d) => d.assignedDriverId).filter((id): id is string => Boolean(id)),
    );
    const delivered = deliveries.filter((d) => {
      const s = (d.status || '').toLowerCase();
      return ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'finished', 'completed', 'pod-completed'].includes(s);
    }).length;
    return {
      uploads,
      totalOrders: deliveries.length,
      activeDrivers: driverIds.size,
      delivered,
    };
  }, [deliveries, recentUploads]);

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
    async (deliveryId: string) => {
      await api.post('/sms/send-confirmation', { deliveryId });
    },
    [],
  );

  const handleResendSMS = useCallback(
    async (orderId: string) => {
      try {
        await sendSmsForDelivery(orderId);
        onNotifySuccess('SMS sent', 'Confirmation SMS queued successfully.');
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        onToastError(err?.response?.data?.error ?? err?.message ?? 'Failed to send SMS');
      }
    },
    [sendSmsForDelivery, onNotifySuccess, onToastError],
  );

  const handleAdminReschedule = useCallback(
    async (orderId: string, newDate: Date, reason: string) => {
      try {
        await api.put(`/deliveries/admin/${orderId}/reschedule`, {
          newDeliveryDate: newDate.toISOString(),
          reason,
        });
        updateDeliveryStatus(orderId, 'rescheduled');
        onNotifySuccess('Delivery rescheduled', 'Customer will be notified by SMS.');
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
    let ok = 0;
    for (const id of ids) {
      try {
        await sendSmsForDelivery(id);
        ok += 1;
      } catch {
        /* continue */
      }
    }
    if (ok > 0) onNotifySuccess('Bulk SMS', `Sent to ${ok} of ${ids.length} orders.`);
    if (ok < ids.length) onToastError(`Some SMS requests failed (${ids.length - ok}).`);
  }, [manageOrders, sendSmsForDelivery, onNotifySuccess, onToastError]);

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
  }, []);

  const handleTrackDelivery = useCallback(() => {
    onSwitchToDeliveriesTab();
  }, [onSwitchToDeliveriesTab]);

  const handleAssignConfirmed = useCallback(() => {
    setDeliveryListFilter('confirmed');
    onSwitchToDeliveriesTab();
  }, [setDeliveryListFilter, onSwitchToDeliveriesTab]);

  return (
    <div className="p-4 lg:p-6 bg-gray-50 dark:bg-gray-900/20 min-h-0 rounded-xl max-w-[1600px] mx-auto w-full">
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

      <div className="mb-6">
        <StatusMetricCards orders={manageOrders} />
      </div>

      <div className="manage-delivery-layout grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
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
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />
        </div>
        <div className="min-w-0 w-full lg:sticky lg:top-4 lg:self-start">
          <ManageSidebar
            orders={manageOrders}
            onFileUpload={(f) => void handleFileUpload(f)}
            onReloadDB={() => void onReloadFromDatabase()}
            onRefresh={() => window.location.reload()}
            onExport={onExportDeliveries}
            onDownloadTemplate={downloadTemplateCsv}
            onAssignConfirmed={handleAssignConfirmed}
            onBulkResendUnconfirmed={() => void handleBulkResendUnconfirmed()}
            isUploading={isUploading}
            isReloading={isReloadingDatabase}
            todayStats={todayStats}
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
