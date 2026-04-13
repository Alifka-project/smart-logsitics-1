"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWhatsAppLink = buildWhatsAppLink;
/**
 * Normalise a phone number for use in a wa.me URL.
 *
 * Works for ANY country — keeps numbers that already carry a country-code prefix.
 * UAE-local short formats are converted; all others are passed through digit-stripped.
 *
 * Examples:
 *   "+971521234567"    → "971521234567"   (E.164 — strip +)
 *   "00971521234567"   → "971521234567"   (IDD prefix)
 *   "0521234567"       → "971521234567"   (UAE local 10-digit)
 *   "521234567"        → "971521234567"   (UAE local 9-digit)
 *   "6281290202027"    → "6281290202027"  (Indonesia — passed through)
 *   "+6281290202027"   → "6281290202027"  (Indonesia E.164 — strip +)
 *   "0812 9020 2027"   → "08129020202"    (Indonesia local — digits only, no country prefix added)
 */
function normalisePhoneForWhatsApp(phone) {
    // 1. Strip everything except digits
    let digits = phone.replace(/\D/g, '');
    // 2. IDD prefix (00 + country code) — remove leading 00
    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }
    // 3. UAE local formats (no country code yet)
    //    9-digit starting with 5  → 971 5xxxxxxxx
    if (digits.length === 9 && digits.startsWith('5')) {
        return '971' + digits;
    }
    //    10-digit starting with 05 → 971 5xxxxxxxx
    if (digits.length === 10 && digits.startsWith('05')) {
        return '971' + digits.slice(1);
    }
    // 4. For all other numbers (international, already has country code)
    //    return as-is (already digits only, country code included)
    return digits;
}
/**
 * Build a wa.me deep-link for manual WhatsApp sending.
 *
 * @param phone  Phone number in any format (E.164, local, with/without + or 00)
 * @param body   Pre-built message text
 * @returns      wa.me URL, e.g. https://wa.me/6281290202027?text=...
 */
function buildWhatsAppLink(phone, body) {
    const digits = normalisePhoneForWhatsApp(String(phone).trim());
    // Guard: must have at least 7 digits to form a valid wa.me URL
    if (digits.length < 7) {
        console.warn(`[waLink] Cannot build WhatsApp link — invalid phone: "${phone}" → "${digits}"`);
        return `https://wa.me/?text=${encodeURIComponent(body)}`;
    }
    return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}
