/**
 * Manage Delivery Order tab — workflow model (separate from API `DeliveryStatus` in ./index).
 */

export type DeliveryStatus =
  | 'uploaded'
  | 'sms_sent'
  | 'unconfirmed'
  | 'confirmed'        // legacy fallback (no confirmedDeliveryDate available)
  | 'tomorrow_shipment'  // confirmed, date = tomorrow
  | 'next_shipment'      // confirmed, date skips a no-delivery day (Sun/Fri/Sat)
  | 'future_shipment'    // confirmed, date = 2+ days out
  | 'scheduled'          // legacy fallback
  | 'order_delay'        // logistics cannot dispatch
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
