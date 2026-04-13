"use strict";
/**
 * Email Service
 * Sends emails for password reset and notifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
exports.getEmailService = getEmailService;
// Simple email adapter (can be replaced with SendGrid, AWS SES, etc.)
class EmailService {
    constructor(config = {}) {
        this.fromEmail = config.FROM_EMAIL || process.env.FROM_EMAIL || 'noreply@logistics.com';
        // Consider SMTP "enabled" if either:
        // - SMTP_ENABLED is explicitly true, OR
        // - an SMTP host is provided (common case where flag was forgotten)
        const smtpHost = process.env.SMTP_HOST || config.SMTP_HOST;
        const explicitFlag = (config.SMTP_ENABLED || process.env.SMTP_ENABLED || '').toString().toLowerCase() === 'true';
        this.smtpEnabled = explicitFlag || !!smtpHost;
        this.transporter = null;
        // Try to use nodemailer if available
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodemailer = require('nodemailer');
            if (this.smtpEnabled && smtpHost) {
                this.transporter = nodemailer.createTransport({
                    host: smtpHost,
                    port: parseInt(process.env.SMTP_PORT || config.SMTP_PORT || '587', 10),
                    secure: (process.env.SMTP_SECURE || config.SMTP_SECURE || '').toString().toLowerCase() === 'true',
                    auth: {
                        user: process.env.SMTP_USER || config.SMTP_USER,
                        pass: process.env.SMTP_PASS || config.SMTP_PASS,
                    },
                });
                console.log('[Email] SMTP transporter initialized (host:', smtpHost, ')');
            }
            else {
                // Use console log in development / when SMTP is not configured
                this.transporter = null;
                console.log('[Email] Using console log (SMTP not configured)');
            }
        }
        catch (e) {
            console.warn('[Email] nodemailer not available, using console log');
            this.transporter = null;
        }
    }
    async sendEmail({ to, subject, html, text }) {
        if (!to) {
            throw new Error('Email recipient is required');
        }
        // If SMTP is configured and transporter is available, send real email
        if (this.transporter && this.smtpEnabled) {
            try {
                const result = await this.transporter.sendMail({
                    from: this.fromEmail,
                    to,
                    subject,
                    html,
                    text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML tags for text version
                });
                console.log(`[Email] Sent to ${to}: ${result.messageId}`);
                return { success: true, messageId: result.messageId };
            }
            catch (error) {
                console.error('[Email] Failed to send:', error);
                throw error;
            }
        }
        else {
            // Development/fallback: log email to console
            console.log('\n========== EMAIL (Development Mode) ==========');
            console.log(`To: ${to}`);
            console.log(`Subject: ${subject}`);
            console.log(`From: ${this.fromEmail}`);
            console.log('----------------------------------------');
            console.log(html || text);
            console.log('==========================================\n');
            return { success: true, messageId: `dev-${Date.now()}`, dev: true };
        }
    }
    // Send an email containing the user's login ID and a newly generated temporary password.
    // NOTE: This flow does NOT use reset links or tokens anymore – the backend directly
    // updates the password and this email simply informs the user of their new credentials.
    async sendPasswordResetEmail({ to, username, temporaryPassword }) {
        const subject = 'Your Electrolux portal login details';
        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #011E41; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #011E41; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .warning { background-color: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 5px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Your login details</h1>
          </div>
          <div class="content">
            <p>Hello ${username || 'User'},</p>
            <p>You requested help signing in to the Electrolux Logistics Portal.</p>
            <p>Here are your temporary login details:</p>
            <p><strong>Login ID:</strong> ${username || 'User'}</p>
            <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
            <div class="warning">
              <strong>Important:</strong><br>
              - This temporary password is valid immediately and replaces your previous password.<br>
              - After logging in, please go to <strong>Change password</strong> and set a new password only you know.<br>
              - If you did not request this, please contact your administrator.
            </div>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; ${new Date().getFullYear()} Logistics Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;
        return this.sendEmail({ to, subject, html });
    }
    async sendPasswordResetSuccessEmail({ to, username }) {
        const subject = 'Password Reset Successful - Logistics System';
        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #28a745; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✓ Password Reset Successful</h1>
          </div>
          <div class="content">
            <p>Hello ${username || 'User'},</p>
            <p>Your password has been successfully reset.</p>
            <p>If you did not make this change, please contact support immediately.</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; ${new Date().getFullYear()} Logistics Management System</p>
          </div>
        </div>
      </body>
      </html>
    `;
        return this.sendEmail({ to, subject, html });
    }
}
exports.EmailService = EmailService;
// Singleton instance
let emailServiceInstance = null;
function getEmailService() {
    if (!emailServiceInstance) {
        emailServiceInstance = new EmailService(process.env);
    }
    return emailServiceInstance;
}
