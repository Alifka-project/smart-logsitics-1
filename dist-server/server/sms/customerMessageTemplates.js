"use strict";
/**
 * Canonical Electrolux customer notification copy.
 * SMS (D7) and WhatsApp (D7) must use identical text — single source of truth.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmationRequestMessage = confirmationRequestMessage;
exports.thankYouAfterConfirmationMessage = thankYouAfterConfirmationMessage;
exports.outForDeliveryMessage = outForDeliveryMessage;
exports.orderDelayMessage = orderDelayMessage;
exports.driverArrivingMessage = driverArrivingMessage;
exports.deliveryCompletedMessage = deliveryCompletedMessage;
exports.cancellationMessage = cancellationMessage;
exports.rescheduleNotificationMessage = rescheduleNotificationMessage;
/** poRef: e.g. "#PO123" or "" */
function confirmationRequestMessage(customerName, poRef, confirmationLink) {
    return `Dear ${customerName},

Your Electrolux order ${poRef} is ready for delivery.

Please confirm your preferred delivery date using the link below:
${confirmationLink}

Thank you,
Electrolux Delivery Team.`;
}
/**
 * Same copy as legacy SMS after customer confirms (Dubai calendar date YYYY-MM-DD).
 * If trackingLink is set, append on the next line — same body SMS would carry when enabled.
 */
function thankYouAfterConfirmationMessage(iso, trackingLink) {
    // Format YYYY-MM-DD as human-readable date in Dubai timezone (e.g. "Thursday, 17 April 2026")
    const formatted = new Date(`${iso}T00:00:00+04:00`).toLocaleDateString('en-AE', {
        timeZone: 'Asia/Dubai',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const base = `Thank you for confirming your Electrolux delivery for ${formatted}. You can now track your order in real-time using this link.`;
    if (trackingLink)
        return `${base}\n${trackingLink}`;
    return base;
}
function outForDeliveryMessage(customerName, poRef, trackingLink) {
    return `Dear ${customerName},

Your Electrolux order ${poRef} is out for delivery today.
${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you,
Electrolux Delivery Team`;
}
function orderDelayMessage(customerName, poRef, trackingLink) {
    return `Dear ${customerName},

We regret to inform you that your Electrolux delivery ${poRef} has been delayed and could not be dispatched as scheduled.

Our delivery team will contact you shortly to arrange a new delivery date at your convenience.
${trackingLink ? `\nYou can also view your order status at:\n${trackingLink}\n` : ''}
We apologise for any inconvenience. For assistance, please contact us at +971581046674.

Thank you for your patience,
Electrolux Delivery Team`;
}
/**
 * Sent when the driver is within ~2 km of the customer's address (auto) or
 * when the driver manually taps the "Arrived" button on the order card.
 * Purpose: give the customer a short-notice heads-up to be available at the door.
 */
function driverArrivingMessage(customerName, poRef, trackingLink) {
    return `Dear ${customerName},

Our Electrolux delivery team is arriving shortly with your order ${poRef}. Please be ready to receive your delivery.
${trackingLink ? `\nTrack your delivery:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you,
Electrolux Delivery Team`;
}
function deliveryCompletedMessage(customerName, poRef) {
    return `Dear ${customerName},

Your Electrolux delivery ${poRef} has been completed.

Thank you for choosing Electrolux.`;
}
function cancellationMessage(customerName, poRef, trackingLink) {
    return `Dear ${customerName},

We regret to inform you that your Electrolux order ${poRef} has been cancelled.

If you have any questions or need further assistance, please contact the Electrolux Delivery Team at +971581046674.
${trackingLink ? `\nYou can view your order status at:\n${trackingLink}\n` : ''}
We apologise for any inconvenience.

Thank you,
Electrolux Delivery Team`;
}
function rescheduleNotificationMessage(customerName, poRef, formattedDate, reasonText, trackingLink) {
    return `Dear ${customerName},

We regret to inform you that your Electrolux order ${poRef} has been rescheduled.

New delivery date: ${formattedDate}
Reason: ${reasonText}
${trackingLink ? `\nTrack your delivery:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you for your understanding,
Electrolux Delivery Team`;
}
