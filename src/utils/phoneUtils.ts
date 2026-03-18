/**
 * UAE Phone Number Normalizer (ES Module — frontend/shared)
 * See src/server/utils/phoneUtils.ts for the server-side counterpart.
 */

export function normalizeUAEPhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  let s = String(raw).trim().replace(/[\s\-().]/g, '');

  if (/^\+971\d{7,9}$/.test(s)) return s;
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00971')) return '+971' + s.slice(5);
  if (s.startsWith('971') && s.length >= 10) return '+' + s;
  if (s.startsWith('0') && s.length >= 9 && s.length <= 11) return '+971' + s.slice(1);
  if (/^[5-9]\d{8}$/.test(s)) return '+971' + s;

  return raw;
}

export function isValidUAEPhone(phone: string | null | undefined): boolean {
  return /^\+971[0-9]{7,9}$/.test(String(phone || ''));
}

export function formatUAEPhoneDisplay(raw: string | null | undefined): string {
  const normalized = normalizeUAEPhone(raw);
  if (!normalized || !normalized.startsWith('+971')) return normalized || String(raw ?? '');
  const local = normalized.slice(4);
  if (local.length === 9) return `+971 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
  if (local.length === 8) return `+971 ${local.slice(0, 1)} ${local.slice(1, 4)} ${local.slice(4)}`;
  return normalized;
}
