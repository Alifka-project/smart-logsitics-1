/**
 * Manage Delivery Order tab — workflow model (separate from API `DeliveryStatus` in ./index).
 */

export type DeliveryStatus =
  | 'uploaded'
  | 'sms_sent'
  | 'unconfirmed'
  | 'confirmed'
  | 'scheduled'
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
  smssentAt?: Date;
  confirmedAt?: Date;
  scheduledDate?: Date;
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
