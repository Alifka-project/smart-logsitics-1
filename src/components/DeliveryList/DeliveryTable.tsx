import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import DeliveryCard from './DeliveryCard';
import type { Delivery } from '../../types';
import {
  applyDeliveryListFilter,
  countForDeliveryListFilter,
  type DeliveryListFilter,
  getOnRouteDeliveriesForList,
  isActiveDeliveryListStatus,
  isOnRouteDeliveryListStatus,
} from '../../utils/deliveryListFilter';
import { isPickingListEligible, isDriverMyOrdersStatus } from '../../utils/pickingListFilter';

interface DeliveryTableProps {
  onSelectDelivery: () => void;
  onCloseDetailModal?: () => void;
  onHoverDelivery?: (index: number | null) => void;
  onReorder?: (items: Delivery[]) => void;
  /**
   * When true (driver portal + team Deliveries route tab): the draggable list and
   * default "active" scope only include on-route statuses — not pending/scheduled uploads.
   */
  onRouteSequenceOnly?: boolean;
  /**
   * When true (driver portal unified view): shows a single delivery table with
   * full chip set — All | On Route | Confirmed | P1 Urgent | On Time | Delayed | Delivered.
   * Replaces the onRouteSequenceOnly + sub-tab pattern.
   */
  isDriverPortal?: boolean;
}

// ─── Priority sort helper (driver portal) ─────────────────────────────────────
// Priority is owned by Delivery Team / Admin via metadata.isPriority.
// Returns 0 for manual-priority orders, 1 for everyone else.
function driverPriorityScore(d: Delivery): number {
  const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
  return meta?.isPriority === true ? 0 : 1;
}

// ─── Export helpers ────────────────────────────────────────────────────────────

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function photoSrc(p: unknown): string {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    const rec = p as Record<string, unknown>;
    const raw = rec.data ?? rec.url ?? '';
    return typeof raw === 'string' ? raw : '';
  }
  return '';
}

function exportToExcel(rows: Delivery[]): void {
  const data = rows.map((d, i) => ({
    '#': i + 1,
    'Customer': d.customer ?? '',
    'Address': d.address ?? '',
    'Phone': d.phone ?? '',
    'PO Number': d.poNumber ?? '',
    'Delivery Number': (d as unknown as Record<string, unknown>).deliveryNumber as string ?? '',
    'Status': d.status ?? '',
    'Items': d.items ?? '',
    'Notes': d.conditionNotes ?? d.deliveryNotes ?? '',
    'Delivered At': fmtDate(d.deliveredAt ?? d.podCompletedAt),
    'POD Photos': d.photos ? (d.photos as unknown[]).length + ' photo(s)' : '—',
    'Driver Sig': d.driverSignature ? 'Yes' : '—',
    'Customer Sig': d.customerSignature ? 'Yes' : '—',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Deliveries');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `driver-deliveries-${date}.xlsx`);
}

function exportToHTML(rows: Delivery[]): void {
  const rows_html = rows.map((d, i) => {
    const photos = (d.photos as unknown[] | null | undefined) ?? [];
    const photoImgs = photos.map((p, pi) => {
      const src = photoSrc(p);
      if (!src) return '';
      const imgSrc = src.startsWith('data:') || src.startsWith('http') ? src : `data:image/jpeg;base64,${src}`;
      return `<img src="${imgSrc}" alt="Photo ${pi + 1}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid #e5e7eb;object-fit:cover;" />`;
    }).join('');
    const sigSection = [
      d.driverSignature ? `<div><strong>Driver Signature</strong><br/><img src="${d.driverSignature.startsWith('data:') ? d.driverSignature : `data:image/png;base64,${d.driverSignature}`}" style="max-width:200px;border:1px solid #e5e7eb;border-radius:4px;" /></div>` : '',
      d.customerSignature ? `<div><strong>Customer Signature</strong><br/><img src="${d.customerSignature.startsWith('data:') ? d.customerSignature : `data:image/png;base64,${d.customerSignature}`}" style="max-width:200px;border:1px solid #e5e7eb;border-radius:4px;" /></div>` : '',
    ].filter(Boolean).join('');
    const s = (d.status || '').toLowerCase();
    const isOk = ['delivered','delivered-with-installation','delivered-without-installation','completed','pod-completed'].includes(s);
    const statusBg = isOk ? '#d1fae5' : s === 'cancelled' ? '#fee2e2' : '#fed7aa';
    const statusColor = isOk ? '#065f46' : s === 'cancelled' ? '#991b1b' : '#9a3412';
    return `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:20px;page-break-inside:avoid;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <span style="background:#1e40af;color:#fff;border-radius:50%;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${i+1}</span>
          <span style="font-size:17px;font-weight:700;color:#111827;">${d.customer ?? '—'}</span>
          <span style="background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">${d.status ?? '—'}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151;">
          <tr><td style="padding:4px 8px;width:130px;color:#6b7280;font-weight:500;">PO Number</td><td style="padding:4px 8px;font-family:inherit;letter-spacing:0.02em;">${d.poNumber ?? '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280;font-weight:500;">Items</td><td style="padding:4px 8px;">${d.items ?? '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280;font-weight:500;">Address</td><td style="padding:4px 8px;">${d.address ?? '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280;font-weight:500;">Phone</td><td style="padding:4px 8px;">${d.phone ?? '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280;font-weight:500;">Delivered At</td><td style="padding:4px 8px;">${fmtDate(d.deliveredAt ?? d.podCompletedAt)}</td></tr>
          ${d.conditionNotes ? `<tr><td style="padding:4px 8px;color:#6b7280;font-weight:500;">Notes</td><td style="padding:4px 8px;">${d.conditionNotes}</td></tr>` : ''}
        </table>
        ${photoImgs || sigSection ? `
          <div style="margin-top:14px;border-top:1px solid #f3f4f6;padding-top:14px;">
            <div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:8px;">POD Evidence</div>
            <div style="display:flex;flex-wrap:wrap;gap:10px;">${photoImgs}${sigSection}</div>
          </div>
        ` : ''}
      </div>`;
  }).join('');

  const date = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Driver Delivery Report — ${date}</title>
  <style>*{box-sizing:border-box;}body{font-family:'Electrolux Sans','DM Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;padding:24px;color:#111827;}h1{font-size:22px;font-weight:700;margin-bottom:4px;}p.sub{font-size:13px;color:#6b7280;margin-bottom:24px;}@media print{body{background:#fff;padding:12px;}}</style>
  </head><body>
  <h1>Driver Delivery Report</h1><p class="sub">Generated: ${date} &nbsp;·&nbsp; ${rows.length} order(s)</p>
  ${rows_html}
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `driver-report-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DeliveryTable({
  onSelectDelivery,
  onCloseDetailModal,
  onHoverDelivery,
  onReorder,
  onRouteSequenceOnly = false,
  isDriverPortal = false,
}: DeliveryTableProps) {
  const allDeliveries = useDeliveryStore((state) => state.deliveries ?? []);
  const deliveryListFilter = useDeliveryStore((state) => state.deliveryListFilter ?? 'all');
  const setDeliveryListFilter = useDeliveryStore((state) => state.setDeliveryListFilter);
  const updateDeliveryOrder = useDeliveryStore((state) => state.updateDeliveryOrder);
  const selectDelivery = useDeliveryStore((state) => state.selectDelivery);

  const [selectedDriver, setSelectedDriver] = useState<string>('all');

  // Driver portal: My Orders / Delivery Sequence only shows orders whose pickup
  // has already been confirmed — pickup-confirmed (Ready to Depart), out-for-
  // delivery / in-transit (On Route), and terminal rows (delivered, cancelled,
  // returned) for history. Everything pre-pickup-confirmation — pending,
  // scheduled, confirmed, pgi-done, pickup-awaiting-pick — is filtered out.
  // Picking-stage rows (pgi-done / rescheduled-with-GMD) live on the Picking
  // List tab instead.
  const deliveries = useMemo(() => {
    if (!isDriverPortal) return allDeliveries;
    return allDeliveries.filter((d) => {
      if (isPickingListEligible(d)) return false;
      return isDriverMyOrdersStatus(d.status);
    });
  }, [allDeliveries, isDriverPortal]);

  // Portal embed: clear filters that don't apply to the on-route sequence view
  // (isDriverPortal has its own chip set that includes confirmed/out_for_delivery)
  useEffect(() => {
    if (!onRouteSequenceOnly || isDriverPortal) return;
    if (deliveryListFilter === 'pending' || deliveryListFilter === 'confirmed' || deliveryListFilter === 'out_for_delivery') {
      setDeliveryListFilter('all');
    }
  }, [onRouteSequenceOnly, isDriverPortal, deliveryListFilter, setDeliveryListFilter]);

  const {
    items,
    setItems,
    draggedIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragAndDrop<Delivery>(deliveries);

  useEffect(() => {
    setItems(deliveries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries]);

  const activeFromItems = useMemo(() => {
    if (onRouteSequenceOnly && !isDriverPortal) {
      return items.filter((d) => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
    }
    return items.filter((d) => isActiveDeliveryListStatus((d.status || '').toLowerCase()));
  }, [items, onRouteSequenceOnly, isDriverPortal]);

  // Unique driver names for the On Route filter dropdown
  const driverOptions = useMemo(() => {
    const onRoute = applyDeliveryListFilter(deliveries, 'out_for_delivery');
    const names = new Set<string>();
    for (const d of onRoute) {
      const name = (d.driverName || '').trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [deliveries]);

  const rows = useMemo(() => {
    if (deliveryListFilter === 'all') {
      // In driver portal, always show priority orders at the top
      const base = isDriverPortal
        ? [...activeFromItems].sort((a, b) => driverPriorityScore(a) - driverPriorityScore(b))
        : activeFromItems;
      return base.map((delivery, displayIndex) => ({
        delivery,
        displayIndex,
        dragIndex: items.findIndex((x) => x.id === delivery.id),
      }));
    }
    const bypassOnRoute = deliveryListFilter === 'delivered' || deliveryListFilter === 'p1'
      || deliveryListFilter === 'on_time' || deliveryListFilter === 'delayed';
    const filterSource =
      onRouteSequenceOnly && !isDriverPortal && !bypassOnRoute
        ? getOnRouteDeliveriesForList(deliveries)
        : deliveries;
    let list = applyDeliveryListFilter(filterSource, deliveryListFilter);
    // Apply driver filter for on-route view
    if (deliveryListFilter === 'out_for_delivery' && selectedDriver !== 'all') {
      list = list.filter((d) => (d.driverName || '').trim() === selectedDriver);
    }
    // In driver portal, keep priority orders at the top of every filtered view
    if (isDriverPortal) {
      list = [...list].sort((a, b) => driverPriorityScore(a) - driverPriorityScore(b));
    }
    return list.map((delivery, displayIndex) => ({
      delivery,
      displayIndex,
      // Driver portal on-route filter: provide drag index so stops can be reordered
      dragIndex: (isDriverPortal && deliveryListFilter === 'out_for_delivery')
        ? items.findIndex(x => x.id === delivery.id)
        : undefined as number | undefined,
    }));
  }, [activeFromItems, deliveries, deliveryListFilter, items, selectedDriver, onRouteSequenceOnly, isDriverPortal]);

  // Drag enabled on 'all' filter, plus on-route filter in driver portal (so driver can reorder stops)
  const dragEnabled = deliveryListFilter === 'all' || (isDriverPortal && deliveryListFilter === 'out_for_delivery');

  const handleCardDrop = (): void => {
    if (!dragEnabled) return;
    handleDrop(undefined, (newItems) => {
      if (Array.isArray(newItems) && newItems.length > 0) {
        updateDeliveryOrder(newItems);
        onReorder?.(newItems);
      }
    });
  };

  const handleClick = (delivery: Delivery): void => {
    selectDelivery(delivery.id as string);
    onSelectDelivery();
  };

  const chips: { id: DeliveryListFilter; label: string; activeClass: string }[] = isDriverPortal
    ? [
        // Unified driver portal chip set — picking-eligible rows live on the
        // Picking List tab (no "PGI Done" chip here), and pre-pickup rows
        // (pending / scheduled / confirmed) are hidden entirely so no
        // "Confirmed" chip either. All remaining chips are post-pickup.
        { id: 'all',               label: 'All Orders',        activeClass: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' },
        { id: 'pickup_confirmed',  label: '🚛 Pickup Confirmed', activeClass: 'bg-teal-600 text-white' },
        { id: 'out_for_delivery',  label: '🚚 On Route',       activeClass: 'bg-orange-500 text-white' },
        { id: 'p1',                label: '🚨 P1 Urgent',      activeClass: 'bg-red-600 text-white' },
        { id: 'on_time',           label: '✓ On Time',         activeClass: 'bg-green-600 text-white' },
        { id: 'delayed',           label: '⚠ Delayed',         activeClass: 'bg-amber-500 text-white' },
        { id: 'delivered',         label: '✅ Completed',      activeClass: 'bg-green-700 text-white' },
      ]
    : onRouteSequenceOnly
      ? [
          { id: 'all',       label: 'All Orders', activeClass: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' },
          { id: 'p1',        label: 'P1 Urgent',  activeClass: 'bg-red-600 text-white' },
          { id: 'on_time',   label: '✓ On Time',  activeClass: 'bg-green-600 text-white' },
          { id: 'delayed',   label: '⚠ Delayed',  activeClass: 'bg-orange-500 text-white' },
          { id: 'delivered', label: 'Delivered',  activeClass: 'bg-green-700 text-white' },
        ]
      : [
          { id: 'all',              label: 'All Active',      activeClass: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' },
          { id: 'pending',          label: 'Pending',         activeClass: 'bg-yellow-500 text-white' },
          { id: 'confirmed',        label: 'Confirmed',       activeClass: 'bg-blue-600 text-white' },
          { id: 'pgi_done',         label: 'PGI Done',        activeClass: 'bg-amber-500 text-white' },
          { id: 'pickup_confirmed', label: 'Pickup Confirmed', activeClass: 'bg-teal-600 text-white' },
          { id: 'out_for_delivery', label: 'On Route',        activeClass: 'bg-orange-500 text-white' },
          { id: 'p1',               label: 'P1 Urgent',       activeClass: 'bg-red-600 text-white' },
          { id: 'delivered',        label: 'Delivered',       activeClass: 'bg-green-600 text-white' },
        ];

  const isDeliveredFilter = deliveryListFilter === 'delivered'; // used for "Completed" empty state
  // Driver portal: when My Orders is empty but orders are waiting in the Picking
  // List tab, surface that so the driver knows where to look.
  const pendingPickingCount = isDriverPortal
    ? allDeliveries.filter((d) => isPickingListEligible(d)).length
    : 0;

  return (
    <div className="pp-dash-card p-4 sm:p-6 transition-colors">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100">
              🚚 Delivery Sequence
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {isDriverPortal
                ? (dragEnabled ? 'Drag to reorder · ' : 'Filter by type below · ')
                : onRouteSequenceOnly
                  ? 'On-route orders only · '
                  : dragEnabled
                    ? 'Drag to reorder · '
                    : isDeliveredFilter
                      ? 'Completed orders · '
                      : 'Clear filters to reorder · '}
              Tap to view
            </p>
          </div>
          {/* Export buttons — always visible, export current filtered rows */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => exportToExcel(rows.map(r => r.delivery))}
              disabled={rows.length === 0}
              title="Export to Excel"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              📊 Excel
            </button>
            <button
              type="button"
              onClick={() => exportToHTML(rows.map(r => r.delivery))}
              disabled={rows.length === 0}
              title="Export to HTML report (includes POD images)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              📄 Report
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const count = countForDeliveryListFilter(deliveries, c.id);
            const active = deliveryListFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setDeliveryListFilter(c.id);
                  setSelectedDriver('all');
                }}
                className={`text-xs sm:text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? c.activeClass
                    : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {c.label} ({count})
              </button>
            );
          })}
        </div>
        {/* Driver dropdown — only shown when On Route filter is active */}
        {deliveryListFilter === 'out_for_delivery' && driverOptions.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 font-medium">Driver:</label>
            <select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              className="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Drivers ({countForDeliveryListFilter(deliveries, 'out_for_delivery')})</option>
              {driverOptions.map((name) => {
                const count = applyDeliveryListFilter(deliveries, 'out_for_delivery').filter(
                  (d) => (d.driverName || '').trim() === name,
                ).length;
                return (
                  <option key={name} value={name}>{name} ({count})</option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-2 sm:space-y-3">
        {rows.map(({ delivery, displayIndex, dragIndex }) => {
          const dIdx = dragIndex ?? -1;
          const canDrag = dragEnabled && dIdx >= 0;
          return (
            <DeliveryCard
              key={delivery.id}
              delivery={delivery}
              displayIndex={displayIndex}
              dragIndex={canDrag ? dIdx : undefined}
              dragDisabled={!canDrag}
              onClick={() => handleClick(delivery)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleCardDrop}
              isDragging={canDrag && draggedIndex === dIdx}
              isDragOver={canDrag && dragOverIndex === dIdx}
              onCloseDetailModal={onCloseDetailModal}
              onMouseEnter={() => onHoverDelivery?.(displayIndex)}
              onMouseLeave={() => onHoverDelivery?.(null)}
            />
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
          {isDeliveredFilter
            ? 'No completed deliveries in the last 3 days. Delivered and cancelled orders from the past 3 days appear here.'
            : isDriverPortal && pendingPickingCount > 0
              ? `No orders ready to dispatch yet. ${pendingPickingCount} order${pendingPickingCount === 1 ? '' : 's'} waiting in the Picking List tab — confirm pickup items there first.`
              : 'No deliveries match this filter.'}
        </div>
      )}
    </div>
  );
}
