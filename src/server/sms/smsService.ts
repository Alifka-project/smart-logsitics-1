/**
 * SMS Service - Handles SMS communication and confirmation flow
 * Uses Twilio adapter with fallback to mock for testing
 */

import crypto from 'crypto';
import prisma from '../db/prisma';
import { normalizeUAEPhone } from '../utils/phoneUtils';
import { SmsSendOptions, SmsSendResult } from './adapter';

interface SmsAdapterLike {
  sendSms(options: SmsSendOptions): Promise<SmsSendResult>;
}

// Initialize SMS adapter — D7 Networks primary, Twilio fallback, then mock
let smsAdapter: SmsAdapterLike | null = null;
const smsProvider = process.env.SMS_PROVIDER || 'd7';

try {
  if (smsProvider === 'd7' || process.env.D7_API_TOKEN) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const D7Adapter = require('./d7Adapter').default;
    smsAdapter = new D7Adapter(process.env) as SmsAdapterLike;
    console.log('[SMS] D7 Networks adapter initialized');
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TwilioAdapter = require('./twilioAdapter').default;
    smsAdapter = new TwilioAdapter(process.env) as SmsAdapterLike;
    console.log('[SMS] Twilio adapter initialized');
  }
} catch (e: unknown) {
  const err = e as Error;
  console.warn('[SMS] Adapter init failed, using mock:', err.message);
  smsAdapter = {
    sendSms: async ({ to, body }: SmsSendOptions): Promise<SmsSendResult> => {
      console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
      return { messageId: `mock-${Date.now()}`, status: 'queued' };
    }
  };
}

/**
 * Generate a unique confirmation token
 * @returns 32-character hex token
 */
function generateConfirmationToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

interface SendConfirmationSmsResult {
  ok: boolean;
  token: string;
  messageId: string;
  phoneNumber: string;
  expiresAt: string;
}

/**
 * Send confirmation SMS to customer
 */
async function sendConfirmationSms(
  deliveryId: string,
  phoneNumber: string,
  tokenExpiry: Date | null = null
): Promise<SendConfirmationSmsResult> {
  try {
    if (!deliveryId || !phoneNumber) {
      throw new Error('deliveryId and phoneNumber are required');
    }

    // Normalize UAE phone number before sending
    const normalizedPhone = normalizeUAEPhone(phoneNumber) || phoneNumber;
    if (normalizedPhone !== phoneNumber) {
      console.log(`[smsService] Phone normalized: "${phoneNumber}" → "${normalizedPhone}"`);
    }
    const finalPhone = normalizedPhone;

    // Generate unique token
    const confirmationToken = generateConfirmationToken();
    // 30 days — customers may receive stock in the next month
    const expiresAt = tokenExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Get delivery details
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      throw new Error(`Delivery not found: ${deliveryId}`);
    }

    // Create confirmation link
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${confirmationToken}`;

    // Create SMS message (same format as main send-sms flow)
    const customerName = (delivery as Record<string, unknown>).customer as string || 'Valued Customer';
    const poNumber = (delivery as Record<string, unknown>).poNumber as string | undefined;
    const poRef = poNumber ? `#${poNumber}` : '';
    const smsMessage = `Dear ${customerName},

Your Electrolux order ${poRef} is ready for delivery.

Please confirm your preferred delivery date using the link below:
${confirmationLink}

For assistance, please contact the Electrolux Delivery Team at +971524408687.

Thank you,
Electrolux Delivery Team`;

    // Send SMS
    const smsResult = await smsAdapter!.sendSms({
      to: finalPhone,
      body: smsMessage,
      metadata: { deliveryId, type: 'confirmation_request' }
    });

    // Update delivery with token
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        confirmationToken,
        tokenExpiresAt: expiresAt,
        confirmationStatus: 'pending'
      } as Record<string, unknown>
    });

    // Log SMS
    await (prisma as any).smsLog.create({
      data: {
        deliveryId,
        phoneNumber: finalPhone,
        messageContent: smsMessage,
        smsProvider: process.env.SMS_PROVIDER || 'twilio',
        externalMessageId: smsResult.messageId,
        status: smsResult.status || 'sent',
        sentAt: new Date(),
        metadata: {
          type: 'confirmation_request',
          tokenExpiry: expiresAt.toISOString()
        }
      }
    });

    return {
      ok: true,
      token: confirmationToken,
      messageId: smsResult.messageId,
      phoneNumber: finalPhone,
      expiresAt: expiresAt.toISOString()
    };
  } catch (error: unknown) {
    console.error('[SMS] Failed to send confirmation SMS:', error);
    throw error;
  }
}

interface ValidationResult {
  isValid: boolean;
  delivery?: Record<string, unknown>;
  alreadyConfirmed?: boolean;
  error?: string;
}

/**
 * Validate and retrieve delivery by confirmation token
 */
async function validateConfirmationToken(token: string): Promise<ValidationResult> {
  try {
    if (!token) {
      return { isValid: false, error: 'Token is required' };
    }

    const delivery = await prisma.delivery.findUnique({
      where: { confirmationToken: token } as any
    }) as Record<string, unknown> | null;

    if (!delivery) {
      return { isValid: false, error: 'Token not found' };
    }

    // Check standard token expiry (30 days from send)
    if (delivery.tokenExpiresAt && new Date() > (delivery.tokenExpiresAt as unknown as Date)) {
      return { isValid: false, error: 'This confirmation link has expired.', delivery };
    }

    // After delivery, link expires 3 days after the delivery date
    const deliveredStatuses = ['delivered', 'delivered-with-installation', 'delivered-without-installation'];
    if (deliveredStatuses.includes(delivery.status as string) && delivery.deliveredAt) {
      const expireAfterDelivery = new Date(delivery.deliveredAt as Date);
      expireAfterDelivery.setDate(expireAfterDelivery.getDate() + 3);
      if (new Date() > expireAfterDelivery) {
        return { isValid: false, error: 'This link is no longer available. Your delivery has been completed.', delivery };
      }
    }

    // Check if already confirmed
    if (delivery.confirmationStatus === 'confirmed') {
      return { isValid: true, alreadyConfirmed: true, delivery };
    }

    return { isValid: true, delivery };
  } catch (error: unknown) {
    console.error('[SMS] Failed to validate token:', error);
    const e = error as Error;
    return { isValid: false, error: e.message };
  }
}

interface ConfirmDeliveryResult {
  ok: boolean;
  delivery: unknown;
}

/**
 * Confirm delivery and set delivery date
 */
async function confirmDelivery(token: string, deliveryDate: Date): Promise<ConfirmDeliveryResult> {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    const validation = await validateConfirmationToken(token);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const delivery = validation.delivery!;

    // Update delivery with confirmation
    const updatedDelivery = await prisma.delivery.update({
      where: { id: delivery.id as string },
      data: {
        confirmationStatus: 'confirmed',
        customerConfirmedAt: new Date(),
        confirmedDeliveryDate: deliveryDate,
        // Use scheduled-confirmed to align with dashboards / reports
        status: 'scheduled-confirmed'
      } as Record<string, unknown>
    });

    // Log confirmation event
    await (prisma as any).deliveryEvent.create({
      data: {
        deliveryId: delivery.id as string,
        eventType: 'customer_confirmed',
        payload: {
          confirmedAt: new Date().toISOString(),
          selectedDate: deliveryDate.toISOString(),
          token: token.substring(0, 8) + '...', // masked for security
          customerName: delivery.customer || null,
          customerPhone: delivery.phone || null
        },
        actorType: 'customer'
      }
    });

    // Send confirmation SMS
    if (delivery.phone) {
      try {
        const confirmationMessage = `Thank you for confirming your Electrolux delivery for ${new Date(deliveryDate).toLocaleDateString()}. You can now track your order in real-time using this link.`;
        await smsAdapter!.sendSms({
          to: delivery.phone as string,
          body: confirmationMessage,
          metadata: { deliveryId: delivery.id as string, type: 'confirmation_received' }
        });

        // Log confirmation SMS
        await (prisma as any).smsLog.create({
          data: {
            deliveryId: delivery.id as string,
            phoneNumber: delivery.phone as string,
            messageContent: confirmationMessage,
            smsProvider: process.env.SMS_PROVIDER || 'twilio',
            status: 'sent',
            sentAt: new Date(),
            metadata: { type: 'confirmation_received' }
          }
        });
      } catch (smsErr: unknown) {
        console.warn('[SMS] Failed to send confirmation SMS:', smsErr);
      }
    }

    return {
      ok: true,
      delivery: updatedDelivery
    };
  } catch (error: unknown) {
    console.error('[SMS] Failed to confirm delivery:', error);
    throw error;
  }
}

interface SendRescheduleSmsResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send admin-initiated reschedule notification SMS to customer
 */
async function sendRescheduleSms(
  deliveryId: string,
  newDeliveryDate: Date,
  reason?: string
): Promise<SendRescheduleSmsResult> {
  try {
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } }) as Record<string, unknown> | null;
    if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);

    const phone = delivery.phone as string | null;
    if (!phone) return { ok: false, error: 'no_phone' };

    const normalizedPhone = normalizeUAEPhone(phone) || phone;
    const customerName = (delivery.customer as string | null) || 'Valued Customer';
    const poNumber = delivery.poNumber as string | undefined;
    const poRef = poNumber ? `#${poNumber}` : '';

    const formattedDate = newDeliveryDate.toLocaleDateString('en-AE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const token = delivery.confirmationToken as string | undefined;
    const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;

    const reasonText = reason ? reason.trim() : 'operational requirements';

    const smsMessage = `Dear ${customerName},

We regret to inform you that your Electrolux order ${poRef} has been rescheduled.

New delivery date: ${formattedDate}
Reason: ${reasonText}
${trackingLink ? `\nTrack your delivery:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971524408687.

Thank you for your understanding,
Electrolux Delivery Team`;

    const smsResult = await smsAdapter!.sendSms({
      to: normalizedPhone,
      body: smsMessage,
      metadata: { deliveryId, type: 'admin_reschedule_notification' }
    });

    await (prisma as any).smsLog.create({
      data: {
        deliveryId,
        phoneNumber: normalizedPhone,
        messageContent: smsMessage,
        smsProvider: process.env.SMS_PROVIDER || 'd7',
        externalMessageId: smsResult.messageId,
        status: smsResult.status || 'sent',
        sentAt: new Date(),
        metadata: { type: 'admin_reschedule_notification', newDeliveryDate: newDeliveryDate.toISOString(), reason: reasonText }
      }
    });

    return { ok: true, messageId: smsResult.messageId };
  } catch (error: unknown) {
    const e = error as Error;
    console.error('[SMS] Failed to send reschedule SMS:', e.message);
    return { ok: false, error: e.message };
  }
}

interface CustomerTrackingResult {
  delivery: {
    id: unknown;
    customer: unknown;
    address: unknown;
    poNumber: unknown;
    items: unknown;
    status: unknown;
    confirmedDeliveryDate: unknown;
    rescheduleReason: string | null;
    rescheduledAt: string | null;
    lat: unknown;
    lng: unknown;
  };
  tracking: {
    assignment: unknown;
    driverLocation: unknown;
    events: unknown[];
    eta: unknown;
  };
}

/**
 * Get customer tracking info by token
 */
async function getCustomerTracking(token: string): Promise<CustomerTrackingResult> {
  try {
    const validation = await validateConfirmationToken(token);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const delivery = validation.delivery!;

    // Get assignment info
    const assignment = await (prisma as any).deliveryAssignment.findFirst({
      where: { deliveryId: delivery.id as string, status: 'assigned' },
      include: {
        driver: {
          select: {
            id: true,
            fullName: true,
            phone: true
          }
        }
      }
    }) as Record<string, unknown> | null;

    // Get latest location if driver is assigned
    let driverLocation = null;
    if (assignment) {
      driverLocation = await (prisma as any).liveLocation.findFirst({
        where: { driverId: assignment.driverId as string },
        orderBy: { recordedAt: 'desc' }
      });
    }

    // Get delivery events (timeline)
    const events = await (prisma as any).deliveryEvent.findMany({
      where: { deliveryId: delivery.id as string },
      orderBy: { createdAt: 'asc' }
    });

    const meta = (delivery.metadata && typeof delivery.metadata === 'object')
      ? delivery.metadata as Record<string, unknown>
      : {};

    return {
      delivery: {
        id: delivery.id,
        customer: delivery.customer,
        address: delivery.address,
        poNumber: delivery.poNumber,
        items: delivery.items,
        status: delivery.status,
        confirmedDeliveryDate: delivery.confirmedDeliveryDate,
        rescheduleReason: (meta.rescheduleReason as string | null) ?? null,
        rescheduledAt: (meta.rescheduledAt as string | null) ?? null,
        lat: delivery.lat,
        lng: delivery.lng
      },
      tracking: {
        assignment,
        driverLocation,
        events,
        eta: (assignment as Record<string, unknown> | null)?.eta
      }
    };
  } catch (error: unknown) {
    console.error('[SMS] Failed to get customer tracking:', error);
    throw error;
  }
}

export {
  generateConfirmationToken,
  sendConfirmationSms,
  sendRescheduleSms,
  validateConfirmationToken,
  confirmDelivery,
  getCustomerTracking,
  smsAdapter
};
