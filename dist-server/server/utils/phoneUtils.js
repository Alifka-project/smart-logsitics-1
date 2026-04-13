"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUAEPhone = void 0;
exports.normalizePhone = normalizePhone;
exports.isValidUAEPhone = isValidUAEPhone;
exports.isValidPhone = isValidPhone;
/**
 * Phone Number Normalizer
 *
 * Default behaviour: treat numbers as UAE (+971) unless they already
 * carry a full international country code (e.g. +62, +1, +44 …).
 *
 * UAE formats handled:
 *   058591321       → +97158591321   (local mobile with leading 0)
 *   58591321        → +97158591321   (local mobile without leading 0)
 *   0501234567      → +971501234567  (10-digit local with leading 0)
 *   501234567       → +971501234567  (9-digit local without leading 0)
 *   971501234567    → +971501234567  (country code without +)
 *   00971501234567  → +971501234567  (00 international prefix)
 *   +971501234567   → +971501234567  (already E.164)
 *
 * International numbers (passed through unchanged):
 *   +6281290202027  → +6281290202027 (Indonesia)
 *   +44 7911 123456 → +447911123456  (UK, spaces stripped)
 *   +1 415 555 0100 → +14155550100   (US, spaces stripped)
 */
function normalizePhone(raw) {
    if (raw === null || raw === undefined || raw === '')
        return null;
    // Strip whitespace, dashes, dots, parentheses
    let s = String(raw).trim().replace(/[\s\-().]/g, '');
    // ── Already valid E.164 with a non-UAE country code ──────────────────────
    // If it starts with + followed by a digit that is NOT 971, treat as
    // international and just strip any remaining separators.
    if (s.startsWith('+')) {
        const withoutPlus = s.slice(1);
        // Starts with +971 → fall through to UAE normalisation below
        if (!withoutPlus.startsWith('971')) {
            // International number — return as-is (separators already stripped)
            return s;
        }
        // Strip leading + for uniform UAE processing
        s = withoutPlus;
    }
    // ── UAE normalisation ─────────────────────────────────────────────────────
    // Already E.164 +971...
    if (s.startsWith('+971'))
        return s;
    // 00971 international dialling prefix
    if (s.startsWith('00971'))
        return '+971' + s.slice(5);
    // 971XXXXXXXXX (country code, no + or 00)
    if (s.startsWith('971') && s.length >= 10)
        return '+' + s;
    // Local format with leading 0 (05X, 04, 02, …)
    if (s.startsWith('0') && s.length >= 8 && s.length <= 11) {
        return '+971' + s.slice(1);
    }
    // 8 or 9-digit local number without leading 0
    // Covers 5XXXXXXXX (9-digit mobile) and 5XXXXXXX (8-digit shortened mobile)
    if (/^[2-9]\d{7,8}$/.test(s))
        return '+971' + s;
    // Fallback — return original untouched
    return raw;
}
// Keep old name as alias so existing imports still work
const normalizeUAEPhone = normalizePhone;
exports.normalizeUAEPhone = normalizeUAEPhone;
/**
 * Returns true if the number looks like a valid UAE E.164 number.
 */
function isValidUAEPhone(phone) {
    return /^\+971[0-9]{7,9}$/.test(String(phone || ''));
}
/**
 * Returns true if the number is any valid E.164 international number.
 */
function isValidPhone(phone) {
    return /^\+[1-9]\d{6,14}$/.test(String(phone || ''));
}
