/**
 * SMS Service - Handles SMS communication and confirmation flow
 * Uses Twilio adapter with fallback to mock for testing
 */

const crypto = require('crypto');
const prisma = require('../db/prisma');

// Initialize SMS adapter (Twilio or mock)
let smsAdapter = null;
try {
  const TwilioAdapter = require('./twilioAdapter');
  smsAdapter = new TwilioAdapter(process.env);
  console.log('[SMS] Twilio adapter initialized');
} catch (e) {
  console.warn('[SMS] Twilio adapter not available, using mock adapter:', e.message);
  smsAdapter = {
    sendSms: async ({ to, body }) => {
      console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
      return { messageId: `mock-${Date.now()}`, status: 'queued' };
    }
  };
}

/**
 * Generate a unique confirmation token
 * @returns {string} 32-character hex token
 */
function generateConfirmationToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Send confirmation SMS to customer
 * @param {string} deliveryId - Delivery ID
 * @param {string} phoneNumber - Customer phone number
 * @param {Date} tokenExpiry - Token expiration date (default: 48 hours)
 * @returns {Promise<{ok: boolean, token: string, messageId: string, phoneNumber: string}>}
 */
async function sendConfirmationSms(deliveryId, phoneNumber, tokenExpiry = null) {
  try {
    if (!deliveryId || !phoneNumber) {
      throw new Error('deliveryId and phoneNumber are required');
    }

    // Generate unique token
    const confirmationToken = generateConfirmationToken();
    const expiresAt = tokenExpiry || new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Get delivery details
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      throw new Error(`Delivery not found: ${deliveryId}`);
    }

    // Create confirmation link
    const frontendUrl = process.env.FRONTEND_URL || 'https://smart-logistics-1.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${confirmationToken}`;

    // Create SMS message
    const smsMessage = `Hi ${delivery.customer || 'there'},

Your order from Electrolux is ready for delivery confirmation.

Click to confirm and select your delivery date:
${confirmationLink}

This link expires in 48 hours.

Thank you!`;

    // Send SMS
    const smsResult = await smsAdapter.sendSms({
      to: phoneNumber,
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
      }
    });

    // Log SMS
    await prisma.smsLog.create({
      data: {
        deliveryId,
        phoneNumber,
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
      phoneNumber,
      expiresAt: expiresAt.toISOString()
    };
  } catch (error) {
    console.error('[SMS] Failed to send confirmation SMS:', error);
    throw error;
  }
}

/**
 * Validate and retrieve delivery by confirmation token
 * @param {string} token - Confirmation token
 * @returns {Promise<{delivery: object, isValid: boolean, error?: string}>}
 */
async function validateConfirmationToken(token) {
  try {
    if (!token) {
      return { isValid: false, error: 'Token is required' };
    }

    const delivery = await prisma.delivery.findUnique({
      where: { confirmationToken: token }
    });

    if (!delivery) {
      return { isValid: false, error: 'Token not found' };
    }

    // Check if token is expired
    if (delivery.tokenExpiresAt && new Date() > delivery.tokenExpiresAt) {
      return { isValid: false, error: 'Token has expired', delivery };
    }

    // Check if already confirmed
    if (delivery.confirmationStatus === 'confirmed') {
      return { isValid: true, alreadyConfirmed: true, delivery };
    }

    return { isValid: true, delivery };
  } catch (error) {
    console.error('[SMS] Failed to validate token:', error);
    return { isValid: false, error: error.message };
  }
}

/**
 * Confirm delivery and set delivery date
 * @param {string} token - Confirmation token
 * @param {Date} deliveryDate - Selected delivery date
 * @returns {Promise<{ok: boolean, delivery: object}>}
 */
async function confirmDelivery(token, deliveryDate) {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    // Validate token
    const validation = await validateConfirmationToken(token);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const delivery = validation.delivery;

    // Update delivery with confirmation
    const updatedDelivery = await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        confirmationStatus: 'confirmed',
        customerConfirmedAt: new Date(),
        confirmedDeliveryDate: deliveryDate,
        status: 'confirmed'
      }
    });

    // Log confirmation event
    await prisma.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        eventType: 'customer_confirmed',
        payload: {
          confirmedAt: new Date().toISOString(),
          selectedDate: deliveryDate.toISOString(),
          token: token.substring(0, 8) + '...' // masked for security
        },
        actorType: 'customer'
      }
    });

    // Send confirmation SMS
    if (delivery.phone) {
      try {
        const confirmationMessage = `Thank you for confirming your Electrolux delivery for ${new Date(deliveryDate).toLocaleDateString()}. You can now track your order in real-time using this link.`;
        await smsAdapter.sendSms({
          to: delivery.phone,
          body: confirmationMessage,
          metadata: { deliveryId: delivery.id, type: 'confirmation_received' }
        });

        // Log confirmation SMS
        await prisma.smsLog.create({
          data: {
            deliveryId: delivery.id,
            phoneNumber: delivery.phone,
            messageContent: confirmationMessage,
            smsProvider: process.env.SMS_PROVIDER || 'twilio',
            status: 'sent',
            sentAt: new Date(),
            metadata: { type: 'confirmation_received' }
          }
        });
      } catch (smsErr) {
        console.warn('[SMS] Failed to send confirmation SMS:', smsErr);
      }
    }

    return {
      ok: true,
      delivery: updatedDelivery
    };
  } catch (error) {
    console.error('[SMS] Failed to confirm delivery:', error);
    throw error;
  }
}

/**
 * Get customer tracking info by token
 * @param {string} token - Confirmation token
 * @returns {Promise<{delivery: object, tracking: object}>}
 */
async function getCustomerTracking(token) {
  try {
    const validation = await validateConfirmationToken(token);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const delivery = validation.delivery;

    // Get assignment info
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: { deliveryId: delivery.id, status: 'assigned' },
      include: {
        driver: {
          select: {
            id: true,
            fullName: true,
            phone: true
          }
        }
      }
    });

    // Get latest location if driver is assigned
    let driverLocation = null;
    if (assignment) {
      const latestLocation = await prisma.liveLocation.findFirst({
        where: { driverId: assignment.driverId },
        orderBy: { recordedAt: 'desc' }
      });
      driverLocation = latestLocation;
    }

    // Get delivery events (timeline)
    const events = await prisma.deliveryEvent.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { createdAt: 'asc' }
    });

    return {
      delivery: {
        id: delivery.id,
        customer: delivery.customer,
        address: delivery.address,
        poNumber: delivery.poNumber,
        items: delivery.items,
        status: delivery.status,
        confirmedDeliveryDate: delivery.confirmedDeliveryDate,
        lat: delivery.lat,
        lng: delivery.lng
      },
      tracking: {
        assignment,
        driverLocation,
        events,
        eta: assignment?.eta
      }
    };
  } catch (error) {
    console.error('[SMS] Failed to get customer tracking:', error);
    throw error;
  }
}

module.exports = {
  generateConfirmationToken,
  sendConfirmationSms,
  validateConfirmationToken,
  confirmDelivery,
  getCustomerTracking,
  smsAdapter
};
