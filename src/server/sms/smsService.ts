/**
 * SMS Service - Handles SMS communication and confirmation flow
 * Active provider: D7 Networks (d7Adapter). Mock fallback if D7 init fails.
 * Twilio SMS is not wired in; twilioAdapter.ts is kept only as a reference.
 */

import crypto from 'crypto';
import prisma from '../db/prisma';
import { normalizeUAEPhone } from '../utils/phoneUtils';
import { SmsSendOptions, SmsSendResult } from './adapter';
import { sendWhatsApp, isWhatsAppConfigured } from './whatsappApiAdapter';
import { buildWhatsAppLink } from './waLink';
import {
  confirmationRequestMessage,
  thankYouAfterConfirmationMessage,
  rescheduleNotificationMessage
} from './customerMessageTemplates';
import {
  assertSlotAvailable,
  dubaiDayRangeUtc
} from '../services/deliveryCapacityService';

const cache = require('../cache');
const { autoAssignDelivery } = require('../services/autoAssignmentService');

interface SmsAdapterLike {
  sendSms(options: SmsSendOptions): Promise<SmsSendResult>;
}

// Initialize SMS adapter — D7 Networks is the active provider.
// Twilio adapter is disabled (kept as reference in twilioAdapter.ts).
// To re-enable Twilio: swap the import below and set SMS_PROVIDER=twilio.
let smsAdapter: SmsAdapterLike | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const D7Adapter = require('./d7Adapter').default;
  smsAdapter = new D7Adapter(process.env) as SmsAdapterLike;
  console.log('[SMS] D7 Networks adapter initialized');
  // Twilio (disabled): const TwilioAdapter = require('./twilioAdapter').default;
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
  whatsappUrl?: string; // present during SMS compliance-pending period
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
    const smsMessage = confirmationRequestMessage(customerName, poRef, confirmationLink);

    // ── SMS via D7 Networks ───────────────────────────────────────────────────
    const smsResult = await smsAdapter!.sendSms({
      to: finalPhone, body: smsMessage,
      metadata: { deliveryId, type: 'confirmation_request' }
    });
    const whatsappUrl: string | undefined = undefined; // wa.me fallback not needed while SMS is active
    // ── WhatsApp path (kept for reference — temporarily disabled) ─────────────
    // let smsResult: SmsSendResult;
    // let whatsappUrl: string | undefined;
    // if (isWhatsAppConfigured()) {
    //   const waResult = await sendWhatsAppDeliveryConfirmation(finalPhone, {
    //     fullTextBody: smsMessage, customerName, poRef, confirmationLink
    //   });
    //   if (!waResult.ok) {
    //     throw new Error(`WhatsApp confirmation failed: ${waResult.error || 'unknown_error'}`);
    //   }
    //   smsResult = { messageId: waResult.messageId || `wa-${Date.now()}`, status: 'sent' };
    // } else {
    //   whatsappUrl = buildWhatsAppLink(finalPhone, smsMessage);
    //   smsResult = { messageId: `wa-link-${Date.now()}`, status: 'whatsapp_link_generated' };
    // }
    // ──────────────────────────────────────────────────────────────────────────

    // Update delivery with token + mark as scheduled
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        confirmationToken,
        tokenExpiresAt: expiresAt,
        confirmationStatus: 'pending',
        status: 'scheduled',
      } as Record<string, unknown>
    });
    // Non-critical: track send time (requires add_sms_sent_at migration on prod DB)
    prisma.delivery.update({
      where: { id: deliveryId },
      data: { smsSentAt: new Date() } as Record<string, unknown>
    }).catch((e: unknown) => {
      console.warn('[SMS] smsSentAt update skipped (run add_sms_sent_at migration):', (e as Error).message);
    });

    // Log SMS
    await (prisma as any).smsLog.create({
      data: {
        deliveryId,
        phoneNumber: finalPhone,
        messageContent: smsMessage,
        smsProvider: process.env.SMS_PROVIDER || 'd7',
        externalMessageId: smsResult.messageId,
        status: smsResult.status || 'sent',
        sentAt: new Date(),
        metadata: {
          type: 'confirmation_request',
          tokenExpiry: expiresAt.toISOString(),
          channel: 'sms',
        }
      }
    });

    return {
      ok: true,
      token: confirmationToken,
      messageId: smsResult.messageId,
      phoneNumber: finalPhone,
      expiresAt: expiresAt.toISOString(),
      whatsappUrl  // temporary: caller should open this URL to send via WhatsApp
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
  thankYouWhatsappUrl?: string;  // wa.me link for staff to send post-confirmation thank-you
}

/**
 * Confirm delivery and set delivery date (YYYY-MM-DD, Dubai calendar day).
 */
async function confirmDelivery(token: string, deliveryDateInput: Date | string): Promise<ConfirmDeliveryResult> {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    const validation = await validateConfirmationToken(token);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    if (validation.alreadyConfirmed) {
      throw new Error('This delivery was already confirmed.');
    }

    const delivery = validation.delivery!;

    const iso =
      typeof deliveryDateInput === 'string'
        ? deliveryDateInput.split('T')[0]
        : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dubai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(deliveryDateInput));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      throw new Error('Invalid delivery date');
    }

    const meta =
      delivery.metadata && typeof delivery.metadata === 'object'
        ? (delivery.metadata as Record<string, unknown>)
        : null;

    const deliveryId = delivery.id as string;
    const itemsStr = delivery.items as string | null | undefined;

    const confirmedAt = dubaiDayRangeUtc(iso).start;

    const updatedDelivery = await prisma.$transaction(async tx => {
      await assertSlotAvailable(tx, deliveryId, iso, itemsStr, meta);
      return tx.delivery.update({
        where: { id: deliveryId },
        data: {
          confirmationStatus: 'confirmed',
          customerConfirmedAt: new Date(),
          confirmedDeliveryDate: confirmedAt,
          status: 'scheduled-confirmed'
        }
      });
    });

    await (prisma as any).deliveryEvent.create({
      data: {
        deliveryId,
        eventType: 'customer_confirmed',
        payload: {
          confirmedAt: new Date().toISOString(),
          selectedDate: confirmedAt.toISOString(),
          selectedDateDubai: iso,
          token: token.substring(0, 8) + '...',
          customerName: delivery.customer || null,
          customerPhone: delivery.phone || null
        },
        actorType: 'customer'
      }
    });

    try {
      await autoAssignDelivery(deliveryId);
    } catch (assignErr: unknown) {
      console.error('[SMS] Auto-assign after confirmation failed:', assignErr);
    }

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    let thankYouWhatsappUrl: string | undefined;
    if (delivery.phone) {
      try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
        const confirmToken = delivery.confirmationToken as string | undefined;
        const trackingLink = confirmToken ? `${frontendUrl}/customer-tracking/${confirmToken}` : null;
        // Same text as legacy SMS thank-you; optional tracking URL on next line (SMS would include when sent)
        const confirmationMessage = thankYouAfterConfirmationMessage(iso, trackingLink);

        // ── SMS thank-you via D7 ─────────────────────────────────────────────
        const normalizedPhone = normalizeUAEPhone(delivery.phone as string) || (delivery.phone as string);
        const thankYouSmsResult = await smsAdapter!.sendSms({
          to: normalizedPhone,
          body: confirmationMessage,
          metadata: { deliveryId, type: 'confirmation_received' }
        });
        console.log(`[SMS] Thank-you SMS sent to ${normalizedPhone}, id: ${thankYouSmsResult.messageId}`);
        // ── WhatsApp thank-you path (kept for reference — temporarily disabled) ──
        // thankYouWhatsappUrl = buildWhatsAppLink(normalizedPhone, confirmationMessage);
        // const thankYouStatus = 'whatsapp_link_generated';
        // const thankYouProvider = 'whatsapp-link';
        // ────────────────────────────────────────────────────────────────────────

        await (prisma as any).smsLog.create({
          data: {
            deliveryId,
            phoneNumber: normalizedPhone,
            messageContent: confirmationMessage,
            smsProvider: process.env.SMS_PROVIDER || 'd7',
            externalMessageId: thankYouSmsResult.messageId,
            status: thankYouSmsResult.status || 'sent',
            sentAt: new Date(),
            metadata: { type: 'confirmation_received', channel: 'sms' }
          }
        });
      } catch (smsErr: unknown) {
        console.warn('[SMS] Failed to send confirmation SMS:', smsErr);
      }
    }

    return {
      ok: true,
      delivery: updatedDelivery,
      thankYouWhatsappUrl
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
  whatsappUrl?: string;
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
    // Prefer individual 'Name' from original row (B2C) over Ship-to party name (B2B)
    const meta = delivery.metadata && typeof delivery.metadata === 'object'
      ? delivery.metadata as Record<string, unknown> : {};
    const origRow = (meta.originalRow || meta._originalRow) as Record<string, unknown> | undefined;
    const b2cName = origRow?.['Name'] ? String(origRow['Name']).trim() || null : null;
    const customerName = b2cName || (delivery.customer as string | null) || 'Valued Customer';
    const poNumber = delivery.poNumber as string | undefined;
    const poRef = poNumber ? `#${poNumber}` : '';

    // Extract Dubai calendar date from the Date object to avoid UTC edge cases,
    // then format from an explicit Dubai midnight for a consistent date string.
    const dubaiIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(newDeliveryDate);
    const formattedDate = new Date(`${dubaiIso}T00:00:00+04:00`).toLocaleDateString('en-AE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Asia/Dubai',
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const token = delivery.confirmationToken as string | undefined;
    const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;

    const reasonText = reason ? reason.trim() : 'operational requirements';

    const smsMessage = rescheduleNotificationMessage(
      customerName,
      poRef,
      formattedDate,
      reasonText,
      trackingLink
    );

    // ── Reschedule: D7 SMS → WhatsApp API → deep-link ───────────────────────
    let whatsappUrl: string | undefined;
    let smsResult: SmsSendResult;
    let rescheduleProvider = process.env.SMS_PROVIDER || 'd7';
    try {
      smsResult = await smsAdapter!.sendSms({
        to: normalizedPhone, body: smsMessage,
        metadata: { deliveryId, type: 'admin_reschedule_notification' }
      });
      console.log(`[SMS] Reschedule SMS sent to ${normalizedPhone}, id: ${smsResult.messageId}`);
    } catch (d7Err: unknown) {
      console.warn(`[SMS] D7 reschedule SMS failed, trying WhatsApp API:`, (d7Err as Error).message);
      let waSent = false;
      if (isWhatsAppConfigured()) {
        try {
          const waRes = await sendWhatsApp(normalizedPhone, smsMessage);
          if (waRes.ok) {
            rescheduleProvider = 'whatsapp-api';
            smsResult = { messageId: (waRes as Record<string, unknown>).messageId as string || `wa-${Date.now()}`, status: 'sent' };
            waSent = true;
            console.log(`[SMS] Reschedule WhatsApp sent to ${normalizedPhone}`);
          }
        } catch (waErr: unknown) {
          console.warn(`[SMS] WhatsApp API also failed:`, (waErr as Error).message);
        }
      }
      if (!waSent) {
        rescheduleProvider = 'whatsapp-link';
        whatsappUrl = buildWhatsAppLink(normalizedPhone, smsMessage);
        smsResult = { messageId: `wa-link-${Date.now()}`, status: 'whatsapp_link_generated' };
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    await (prisma as any).smsLog.create({
      data: {
        deliveryId,
        phoneNumber: normalizedPhone,
        messageContent: smsMessage,
        smsProvider: rescheduleProvider,
        externalMessageId: smsResult.messageId,
        status: smsResult.status || 'sent',
        sentAt: new Date(),
        metadata: { type: 'admin_reschedule_notification', newDeliveryDate: newDeliveryDate.toISOString(), reason: reasonText, channel: 'sms' }
      }
    });

    return { ok: true, messageId: smsResult.messageId, whatsappUrl };
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
    deliveryNumber: string | null;
    originalDeliveryNumber: string | null;
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
      where: { deliveryId: delivery.id as string },  // remove status filter
      include: {
        driver: {
          select: {
            id: true,
            fullName: true,
            phone: true
          }
        }
      },
      orderBy: { assignedAt: 'desc' }
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

    const originalFromMeta =
      typeof meta.originalDeliveryNumber === 'string' && meta.originalDeliveryNumber.trim()
        ? meta.originalDeliveryNumber.trim()
        : null;
    const deliveryNumberCol =
      typeof (delivery as Record<string, unknown>).deliveryNumber === 'string' &&
      String((delivery as Record<string, unknown>).deliveryNumber).trim()
        ? String((delivery as Record<string, unknown>).deliveryNumber).trim()
        : null;

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
        lng: delivery.lng,
        deliveryNumber: deliveryNumberCol,
        originalDeliveryNumber: originalFromMeta
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
