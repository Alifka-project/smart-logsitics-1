/**
 * UAE Phone Number Normalizer
 *
 * Converts any common UAE phone format to E.164 (+971XXXXXXXXX).
 *
 * Handles all real-world variations seen in SAP/ERP exports and manual entry:
 *   0501234567      → +971501234567   (local with leading 0)
 *   501234567       → +971501234567   (local without leading 0, 9 digits)
 *   971501234567    → +971501234567   (country code, no +)
 *   00971501234567  → +971501234567   (international dialling prefix 00)
 *   +971501234567   → +971501234567   (already E.164, passthrough)
 *   +971 50 123 4567 → +971501234567  (spaces/dashes stripped)
 *   0097150-123-4567 → +971501234567  (mixed punctuation)
 *
 * Returns null for empty/null input.
 * Returns the original string (untouched) if it cannot be identified as UAE.
 */
function normalizeUAEPhone(raw) {
  if (raw === null || raw === undefined || raw === '') return null;

  // Strip whitespace, dashes, dots, parentheses, and other common separators
  let s = String(raw).trim().replace(/[\s\-().]/g, '');

  // ── Already E.164 with +971 ──────────────────────────────────────────────
  if (/^\+971\d{7,9}$/.test(s)) return s;

  // ── Remove leading + for uniform processing ──────────────────────────────
  if (s.startsWith('+')) s = s.slice(1);

  // ── International prefix 00971 ───────────────────────────────────────────
  if (s.startsWith('00971')) return '+971' + s.slice(5);

  // ── Country code 971 (no + or 00) ────────────────────────────────────────
  if (s.startsWith('971') && s.length >= 10) return '+' + s;

  // ── Local format starting with 0 (050..., 04..., etc.) ───────────────────
  if (s.startsWith('0') && s.length >= 9 && s.length <= 11) {
    return '+971' + s.slice(1);
  }

  // ── 9-digit local number without leading 0 (5XXXXXXXX mobile) ────────────
  if (/^[5-9]\d{8}$/.test(s)) return '+971' + s;

  // ── 7-digit landline without area code — too ambiguous, return as-is ─────
  // Can't safely add +971 without knowing the area code

  // ── Fallback: return original (don't corrupt unknown formats) ────────────
  return raw;
}

/**
 * Validate that a phone number looks like a plausible UAE E.164 number.
 * Returns true if the number is in +971XXXXXXXXX format (9–10 local digits).
 */
function isValidUAEPhone(phone) {
  return /^\+971[0-9]{7,9}$/.test(String(phone || ''));
}

/**
 * Format a phone for display (e.g. +971 50 123 4567).
 * Input can be any format — normalizes first.
 */
function formatUAEPhoneDisplay(raw) {
  const normalized = normalizeUAEPhone(raw);
  if (!normalized || !normalized.startsWith('+971')) return normalized || raw;
  const local = normalized.slice(4); // digits after +971
  if (local.length === 9) {
    // Mobile: 050 XXX XXXX → 0X XXX XXXX
    return `+971 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
  }
  if (local.length === 8) {
    // Landline: 04 XXX XXXX
    return `+971 ${local.slice(0, 1)} ${local.slice(1, 4)} ${local.slice(4)}`;
  }
  return normalized;
}

module.exports = { normalizeUAEPhone, isValidUAEPhone, formatUAEPhoneDisplay };
