import * as XLSX from 'xlsx';
import type { Delivery } from '../types';
import { deliveryToManageOrder } from './deliveryWorkflowMap';

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Date-only "28 Apr 2026" — used for plan/schedule columns. */
function fmtDate(d: Date | undefined | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Date + 24h time "28 Apr 2026 11:27" — used for event timestamps. */
function fmtDateTime(d: Date | undefined | null): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Strip the "—" placeholder used by deliveryToManageOrder so empty cells stay empty. */
function clean(s: string | null | undefined): string {
  if (s == null) return '';
  return s === '—' ? '' : s;
}

/** Workflow status enum → human-readable label that matches the UI badges. */
const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  sms_sent: 'SMS Sent',
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed',
  next_shipment: 'Next Shipment',
  future_schedule: 'Future Schedule',
  ready_to_dispatch: 'Ready to Dispatch',
  scheduled: 'Scheduled',
  pgi_done: 'PGI Done',
  pickup_confirmed: 'Pickup Confirmed',
  out_for_delivery: 'Out for Delivery',
  order_delay: 'Order Delay',
  delivered: 'Delivered',
  failed: 'Failed',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

function priorityLabel(
  p: 'normal' | 'high' | 'urgent' | undefined,
  isPriority: boolean,
): string {
  // Manual priority flag from Admin / Delivery Team trumps the auto tier.
  if (isPriority) return 'Urgent';
  if (p === 'urgent') return 'Urgent';
  if (p === 'high') return 'High';
  if (p === 'normal') return 'Normal';
  return '';
}

// ── Row mapping ──────────────────────────────────────────────────────────────

/**
 * One spreadsheet row per delivery, with each piece of structured information
 * in its own column. Sourced from deliveryToManageOrder() so the export shape
 * matches what the OrdersTable already shows in the UI — the table just stacks
 * several fields inside compound cells (Customer, Order, Product, Dates,
 * Driver), and the export breaks them back out.
 *
 * Caveat the caller already accepted: the Excel ingestion stores only the
 * first source row's Material/Model/Description/Qty in metadata.originalRow,
 * so multi-line-item POs are flattened — the "Items" column carries the
 * concatenated raw text, and the structured columns reflect the first line.
 */
function deliveryToRow(d: Delivery, index: number): Record<string, string | number> {
  const o = deliveryToManageOrder(d);
  return {
    'No': index + 1,
    'PO Number': clean(o.orderNumber),
    'Delivery Number': clean(o.deliveryNumber ?? ''),
    'Customer Name': clean(o.customerName),
    'Phone': clean(o.customerPhone),
    'Address': clean(o.address),
    'Area': clean(o.area),
    'Material (PNC)': clean(o.material),
    'Model ID': clean(o.model),
    'Description': clean(o.productDescription),
    'Qty': clean(o.qty),
    'Items': clean(o.product),
    'Status': STATUS_LABEL[o.status] ?? o.status,
    'Priority': priorityLabel(o.priority, o.isPriority === true),
    'Order Type': clean(o.orderType),
    'Driver': clean(o.driverName),
    'Uploaded At': fmtDateTime(o.uploadedAt),
    'SMS Sent At': fmtDateTime(o.smsSentAt),
    'Customer Confirmed At': fmtDateTime(o.confirmedAt),
    'Scheduled Date': fmtDate(o.scheduledDate),
    'Confirmed Delivery Date': fmtDate(o.confirmedDeliveryDate),
    'Goods Movement Date': fmtDate(o.goodsMovementDate),
    'Delivered At': fmtDateTime(o.deliveryDate),
    'Has POD': o.hasPod ? 'Yes' : 'No',
    'Notes': clean(o.notes),
    'Failure Reason': clean(o.failureReason),
  };
}

/** Reasonable column widths so the file opens readable without manual resizing. */
const COL_WIDTHS = [
  5,   // No
  14,  // PO Number
  16,  // Delivery Number
  24,  // Customer Name
  16,  // Phone
  36,  // Address
  14,  // Area
  14,  // Material (PNC)
  18,  // Model ID
  32,  // Description
  6,   // Qty
  36,  // Items
  18,  // Status
  10,  // Priority
  14,  // Order Type
  18,  // Driver
  20,  // Uploaded At
  20,  // SMS Sent At
  22,  // Customer Confirmed At
  14,  // Scheduled Date
  22,  // Confirmed Delivery Date
  20,  // Goods Movement Date
  20,  // Delivered At
  8,   // Has POD
  28,  // Notes
  24,  // Failure Reason
];

/** Export deliveries as Excel (.xlsx) and trigger download */
export function exportAsXlsx(deliveries: Delivery[], filename?: string): void {
  const rows = deliveries.map((d, i) => deliveryToRow(d, i));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = COL_WIDTHS.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Deliveries');
  const name = filename ?? `deliveries-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}

/** Export deliveries as CSV and trigger download */
export function exportAsCsv(deliveries: Delivery[], filename?: string): void {
  const rows = deliveries.map((d, i) => deliveryToRow(d, i));
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
