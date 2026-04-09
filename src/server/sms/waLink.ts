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
  const digits = phone.replace(/\D/g, '');
  const encoded = encodeURIComponent(body);
  return `https://wa.me/${digits}?text=${encoded}`;
}
