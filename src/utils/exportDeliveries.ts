import * as XLSX from 'xlsx';
import type { Delivery } from '../types';
import { deliveryToManageOrder } from './deliveryWorkflowMap';

function deliveryToRow(d: Delivery): Record<string, string> {
  const o = deliveryToManageOrder(d);
  const scheduled =
    o.scheduledDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '';
  return {
    Customer: o.customerName,
    Phone: o.customerPhone,
    'Order #': o.orderNumber,
    Address: o.address,
    Area: o.area,
    Product: o.product,
    Status: o.status,
    'Scheduled Date': scheduled,
    Driver: o.driverName ?? '',
    Notes: o.notes ?? '',
  };
}

/** Export deliveries as Excel (.xlsx) and trigger download */
export function exportAsXlsx(deliveries: Delivery[], filename?: string): void {
  const rows = deliveries.map(deliveryToRow);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Deliveries');
  const name = filename ?? `deliveries-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}

/** Export deliveries as CSV and trigger download */
export function exportAsCsv(deliveries: Delivery[], filename?: string): void {
  const rows = deliveries.map(deliveryToRow);
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
