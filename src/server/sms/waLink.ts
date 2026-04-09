/**
 * WhatsApp deep-link helper (wa.me).
 *
 * TEMPORARY — Used while D7 SMS/WhatsApp API registration is pending
 * compliance approval. Generates a wa.me URL so staff can manually tap the
 * link and send the message to the customer via their own WhatsApp.
 *
 * Once D7 approval is granted, remove all calls to buildWhatsAppLink() and
 * restore the commented smsAdapter.sendSms() / WhatsAppAdapter calls.
 */

/**
 * Build a wa.me deep-link for manual WhatsApp sending.
 * @param phone  E.164 phone string (e.g. "+971521234567") or any format — digits extracted.
 * @param body   Message text (pre-built SMS body).
 * @returns      URL like https://wa.me/971521234567?text=...
 */
export function buildWhatsAppLink(phone: string, body: string): string {
  // Strip everything except digits (removes +, spaces, dashes)
  let digits = phone.replace(/\D/g, '');

  // If no country code, assume UAE (+971) — 9-digit local numbers starting with 5
  if (digits.length === 9 && digits.startsWith('5')) {
    digits = '971' + digits;
  }
  // 10-digit numbers starting with 05 (UAE local format)
  if (digits.length === 10 && digits.startsWith('05')) {
    digits = '971' + digits.slice(1);
  }

  // Guard: must have at least 7 digits to form a valid wa.me URL
  if (digits.length < 7) {
    console.warn(`[waLink] Cannot build WhatsApp link — invalid phone after stripping: "${phone}"`);
    // Return a generic wa.me URL without a number so it at least opens WhatsApp
    return `https://wa.me/?text=${encodeURIComponent(body)}`;
  }

  const encoded = encodeURIComponent(body);
  return `https://wa.me/${digits}?text=${encoded}`;
}
