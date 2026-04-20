"use strict";
/**
 * Email notification service — sends delivery confirmation link via SMTP.
 * Used as a reliable fallback/primary channel when SMS (Twilio) cannot reach
 * the destination country (e.g. UAE carrier restrictions on US numbers).
 *
 * Required env vars (already set on Vercel):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, FROM_EMAIL
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendConfirmationEmail = sendConfirmationEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
/**
 * Build a reusable transporter, lazy-initialised once.
 * Returns null and logs a warning if SMTP is not configured.
 */
function createTransporter() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.warn('[Email] SMTP not configured: missing SMTP_HOST / SMTP_USER / SMTP_PASS');
        return null;
    }
    return nodemailer_1.default.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        tls: { rejectUnauthorized: false }
    });
}
/**
 * Send a delivery confirmation email.
 */
async function sendConfirmationEmail({ toEmail, customerName, confirmationLink, deliveryAddress }) {
    const transporter = createTransporter();
    if (!transporter) {
        return { ok: false, error: 'SMTP not configured' };
    }
    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;
    const addressLine = deliveryAddress
        ? `<p style="color:#555;font-size:14px;">Delivery address: <strong>${deliveryAddress}</strong></p>`
        : '';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:'Electrolux Sans','DM Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#032145;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Electrolux Delivery Confirmation</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="color:#1a1a2e;font-size:16px;margin:0 0 16px;">Hi <strong>${customerName || 'there'}</strong>,</p>
              <p style="color:#444;font-size:15px;margin:0 0 16px;">
                Your order from <strong>Electrolux</strong> is ready for delivery confirmation.
                Please click the button below to confirm and select your preferred delivery date.
              </p>
              ${addressLine}
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0;">
                <tr>
                  <td align="center">
                    <a href="${confirmationLink}"
                       style="display:inline-block;background:#032145;color:#ffffff;font-size:16px;font-weight:600;padding:16px 40px;border-radius:8px;text-decoration:none;">
                      Confirm My Delivery Date →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#888;font-size:13px;margin:0 0 8px;">Or copy this link into your browser:</p>
              <p style="color:#032145;font-size:13px;word-break:break-all;margin:0 0 24px;">
                <a href="${confirmationLink}" style="color:#032145;">${confirmationLink}</a>
              </p>
              <p style="color:#aaa;font-size:12px;margin:0;border-top:1px solid #eee;padding-top:16px;">
                This link expires in <strong>48 hours</strong>. If you have questions, contact your Electrolux representative.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
              <p style="color:#aaa;font-size:12px;margin:0;">© 2026 Electrolux Logistics · All rights reserved</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
    const text = `Hi ${customerName || 'there'},

Your order from Electrolux is ready for delivery confirmation.

Click here to confirm and select your delivery date:
${confirmationLink}

This link expires in 48 hours.

Thank you!
Electrolux Logistics`;
    try {
        const info = await transporter.sendMail({
            from: `"Electrolux Logistics" <${fromEmail}>`,
            to: toEmail,
            subject: 'Your Electrolux Delivery – Confirm Your Date',
            text,
            html
        });
        console.log('[Email] Confirmation email sent:', info.messageId, '→', toEmail);
        return { ok: true, messageId: info.messageId };
    }
    catch (err) {
        const e = err;
        console.error('[Email] Failed to send confirmation email:', e.message);
        return { ok: false, error: e.message };
    }
}
