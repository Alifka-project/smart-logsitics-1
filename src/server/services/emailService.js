/**
 * Email Service
 * Sends emails for password reset and notifications
 */

const crypto = require('crypto');

// Simple email adapter (can be replaced with SendGrid, AWS SES, etc.)
class EmailService {
  constructor(config = {}) {
    this.fromEmail = config.FROM_EMAIL || process.env.FROM_EMAIL || 'noreply@logistics.com';
    this.smtpEnabled = config.SMTP_ENABLED === 'true' || process.env.SMTP_ENABLED === 'true';
    
    // Try to use nodemailer if available
    try {
      const nodemailer = require('nodemailer');
      
      if (this.smtpEnabled && (config.SMTP_HOST || process.env.SMTP_HOST)) {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || config.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || config.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true' || config.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || config.SMTP_USER,
            pass: process.env.SMTP_PASS || config.SMTP_PASS,
          },
        });
        console.log('[Email] SMTP transporter initialized');
      } else {
        // Use console log in development
        this.transporter = null;
        console.log('[Email] Using console log (SMTP not configured)');
      }
    } catch (e) {
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
      } catch (error) {
        console.error('[Email] Failed to send:', error);
        throw error;
      }
    } else {
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

  async sendPasswordResetEmail({ to, username, resetToken, resetUrl }) {
    const subject = 'Password Reset Request - Logistics System';
    
    const resetLink = resetUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
    
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
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hello ${username || 'User'},</p>
            <p>You have requested to reset your password for the Logistics Management System.</p>
            <p>Click the button below to reset your password:</p>
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #011E41;">${resetLink}</p>
            <div class="warning">
              <strong>⚠️ Security Notice:</strong><br>
              This link will expire in 1 hour for security reasons.<br>
              If you did not request this reset, please ignore this email or contact support.
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

// Singleton instance
let emailServiceInstance = null;

function getEmailService() {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService(process.env);
  }
  return emailServiceInstance;
}

module.exports = { EmailService, getEmailService };

