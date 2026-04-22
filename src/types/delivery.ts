/**
 * Manage Delivery Order tab — workflow model (separate from API `DeliveryStatus` in ./index).
 */

export type DeliveryStatus =
  | 'uploaded'
  | 'sms_sent'
  | 'unconfirmed'
  | 'confirmed'          // legacy fallback (no confirmedDeliveryDate available)
  | 'next_shipment'      // confirmed, delivery date = tomorrow only
  | 'future_schedule'    // confirmed, delivery date = 2+ days out
  | 'scheduled'          // legacy fallback
  | 'ready_to_dispatch'  // confirmed + GMD updated, delivery date is future (not today)
  | 'pgi_done'           // GMD uploaded; goods issued by warehouse; awaiting driver pick
  | 'pickup_confirmed'   // driver verified picking list; awaiting Start Delivery
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
  /** Material / PNC code extracted from SAP metadata (e.g. orig['Material']) */
  material?: string;
  /** Order quantity from SAP metadata */
  qty?: string;
  status: DeliveryStatus;
  uploadedAt: Date;
  smsSentAt?: Date;
  confirmedAt?: Date;
  scheduledDate?: Date;
  confirmedDeliveryDate?: Date;
  goodsMovementDate?: Date;
  deliveryDate?: Date;
  driverId?: string;
  driverName?: string;
  priority?: 'normal' | 'high' | 'urgent';
  /** Logistics-only flag toggled via the Priority button in the orders table */
  isPriority?: boolean;
  notes?: string;
  failureReason?: string;
  /** True when the raw DB status is 'rescheduled' — workflow status may be a date bucket. */
  isRescheduled?: boolean;
  /** Order type: B2C has individual customer name, B2B uses Ship-to party as customer. */
  orderType?: 'B2B' | 'B2C';
  /**
   * True when a Proof of Delivery (photo, driver signature, or podCompletedAt timestamp) exists.
   * Delivered orders where this is false must remain visible in the manage orders table
   * until the POD is uploaded.
   */
  hasPod?: boolean;
  /** Timestamp of the last status change — used for time-based retention (e.g. cancelled 3 days, delivered+POD 2 days). */
  statusChangedAt?: Date;
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
