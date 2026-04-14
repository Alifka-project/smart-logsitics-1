/**
 * Canonical Electrolux customer notification copy.
 * SMS (D7) and WhatsApp (D7) must use identical text — single source of truth.
 */

/** poRef: e.g. "#PO123" or "" */
export function confirmationRequestMessage(
  customerName: string,
  poRef: string,
  confirmationLink: string
): string {
  return `Dear ${customerName},

Your Electrolux order ${poRef} is ready for delivery.

Please confirm your preferred delivery date using the link below:
${confirmationLink}

For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you,
Electrolux Delivery Team`;
}

/**
 * Same copy as legacy SMS after customer confirms (Dubai calendar date YYYY-MM-DD).
 * If trackingLink is set, append on the next line — same body SMS would carry when enabled.
 */
export function thankYouAfterConfirmationMessage(iso: string, trackingLink?: string | null): string {
  const base = `Thank you for confirming your Electrolux delivery for ${iso}. You can now track your order in real-time using this link.`;
  if (trackingLink) return `${base}\n${trackingLink}`;
  return base;
}

export function outForDeliveryMessage(
  customerName: string,
  poRef: string,
  trackingLink: string | null
): string {
  return `Dear ${customerName},

Your Electrolux order ${poRef} is out for delivery today.
${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you,
Electrolux Delivery Team`;
}

export function orderDelayMessage(
  customerName: string,
  poRef: string,
  trackingLink: string | null
): string {
  return `Dear ${customerName},

We regret to inform you that your Electrolux delivery ${poRef} has been delayed and could not be dispatched as scheduled.

Our delivery team will contact you shortly to arrange a new delivery date at your convenience.
${trackingLink ? `\nYou can also view your order status at:\n${trackingLink}\n` : ''}
We apologise for any inconvenience. For assistance, please contact us at +971581046674.

Thank you for your patience,
Electrolux Delivery Team`;
}

export function deliveryCompletedMessage(customerName: string, poRef: string): string {
  return `Dear ${customerName},

Your Electrolux delivery ${poRef} has been completed.

Thank you for choosing Electrolux.`;
}

export function rescheduleNotificationMessage(
  customerName: string,
  poRef: string,
  formattedDate: string,
  reasonText: string,
  trackingLink: string | null
): string {
  return `Dear ${customerName},

We regret to inform you that your Electrolux order ${poRef} has been rescheduled.

New delivery date: ${formattedDate}
Reason: ${reasonText}
${trackingLink ? `\nTrack your delivery:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971581046674.

Thank you for your understanding,
Electrolux Delivery Team`;
}
