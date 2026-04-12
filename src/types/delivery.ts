/**
 * Manage Delivery Order tab — workflow model (separate from API `DeliveryStatus` in ./index).
 */

export type DeliveryStatus =
  | 'uploaded'
  | 'sms_sent'
  | 'unconfirmed'
  | 'confirmed'        // legacy fallback (no confirmedDeliveryDate available)
  | 'next_shipment'    // confirmed, date = today / tomorrow / day+2 (≤2 days out)
  | 'future_schedule'  // confirmed, date = 3+ days out
  | 'scheduled'        // legacy fallback
  | 'order_delay'      // logistics cannot dispatch
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'rescheduled'
  | 'cancelled';

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  deliveryNumber?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  area: string;
  address: string;
  product: string;
  productSKU?: string;
  model?: string;
  productDescription?: string;
  status: DeliveryStatus;
  uploadedAt: Date;
  smsSentAt?: Date;
  confirmedAt?: Date;
  scheduledDate?: Date;
  confirmedDeliveryDate?: Date;
  deliveryDate?: Date;
  driverId?: string;
  driverName?: string;
  priority?: 'normal' | 'high' | 'urgent';
  notes?: string;
  failureReason?: string;
  /** True when the raw DB status is 'rescheduled' — workflow status may be a date bucket. */
  isRescheduled?: boolean;
}

/** Optional UI / reporting shape; persisted uploads use `UploadRecord` in the store. */
export interface UploadRecord {
  id: string;
  filename: string;
  fileHash: string;
  orderCount: number;
  uploadedAt: Date;
  status: 'processing' | 'completed' | 'error';
  errorMessage?: string;
}
