/**
 * Authentication API using Prisma ORM
 * Database is REQUIRED - All queries use Prisma
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../db/prisma');
const {
  hashPassword,
  comparePassword,
  generateAccessToken,
  createLoginSession,
} = require('../auth');
const { validatePassword, sanitizeInput } = require('../security/passwordValidator');
const { recordFailedAttempt, recordSuccess, isLocked } = require('../security/accountLockout');
const { loginLimiter } = require('../security/rateLimiter');
const { getEmailService } = require('../services/emailService');

// POST /api/auth/login - with rate limiting and account lockout
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'username_password_required' });
  }
  
  const sanitizedUsername = sanitizeInput(username);
  
  // Check account lockout
  const lockoutStatus = isLocked(sanitizedUsername);
  if (lockoutStatus) {
    return res.status(423).json({
      error: 'account_locked',
      message: `Account locked due to too many failed attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
      lockedUntil: new Date(lockoutStatus.lockedUntil).toISOString()
    });
  }
  
  try {
    // Find driver with account using Prisma
    const driver = await prisma.driver.findUnique({
      where: { username: sanitizedUsername },
      include: {
        account: true
      }
    });
    
    if (!driver || !driver.account) {
      recordFailedAttempt(sanitizedUsername);
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    // Check if account is active
    if (!driver.active) {
      return res.status(403).json({ error: 'account_inactive' });
    }
    
    // Verify password
    const passwordMatch = await comparePassword(password, driver.account.passwordHash);
    
    if (!passwordMatch) {
      recordFailedAttempt(sanitizedUsername);
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    // Successful login
    recordSuccess(sanitizedUsername);
    
    // Update last login using Prisma
    await prisma.account.update({
      where: { driverId: driver.id },
      data: { lastLogin: new Date() }
    });
    
    // Check if driver has phone (required for GPS)
    const needsPhone = !driver.phone;
    const needsGPSActivation = driver.account.role === 'driver' && !driver.gpsEnabled;
    
    const payload = {
      sub: driver.id,
      role: driver.account.role,
      username: driver.username,
      needsPhone,
      needsGPSActivation
    };
    
    // Create server-side session and set cookies
    const { clientKey, csrfToken } = createLoginSession(req, res, payload);
    
    // Generate access token
    const accessToken = generateAccessToken(payload);
    
    res.json({
      driver: {
        id: driver.id,
        username: driver.username,
        full_name: driver.fullName,
        role: driver.account.role
      },
      clientKey,
      csrfToken,
      accessToken,
      expiresIn: 60 * 60 // 1 hour in seconds (matches ACCESS_TOKEN_EXP)
    });
  } catch (err) {
    console.error('auth/login', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', async (req, res) => {
  try {
    const { user } = req; // Set by authenticate middleware
    
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    // Get driver with account using Prisma
    const driver = await prisma.driver.findUnique({
      where: { id: user.id },
      include: {
        account: true
      }
    });
    
    if (!driver) {
      return res.status(401).json({ error: 'user_not_found' });
    }
    
    res.json({
      user: {
        id: driver.id,
        username: driver.username,
        full_name: driver.fullName,
        role: driver.account.role,
        email: driver.email
      },
      csrfToken: (typeof req.csrfToken === 'string' ? req.csrfToken : null) ?? 'dev-csrf-token'
    });
  } catch (err) {
    console.error('auth/me', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { username, email } = req.body;
  
  if (!username && !email) {
    return res.status(400).json({ error: 'username_or_email_required' });
  }
  
  try {
    // Find driver by username or email
    const driver = await prisma.driver.findFirst({
      where: {
        OR: [
          username ? { username: sanitizeInput(username) } : {},
          email ? { email: email.toLowerCase().trim() } : {},
        ].filter(obj => Object.keys(obj).length > 0),
      },
      include: {
        account: true
      }
    });
    
    // Always return success to prevent user enumeration attacks
    if (!driver || !driver.account) {
      // Still return success, but don't send email
      return res.json({ 
        success: true, 
        message: 'If an account exists with that username/email, a password reset link has been sent.' 
      });
    }
    
    if (!driver.email) {
      return res.status(400).json({ 
        error: 'no_email_configured',
        message: 'This account does not have an email address configured. Please contact support.' 
      });
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Token valid for 1 hour
    
    // Delete any existing reset tokens for this account
    await prisma.passwordReset.deleteMany({
      where: { 
        accountId: driver.account.id,
        used: false
      }
    });
    
    // Create new reset token
    await prisma.passwordReset.create({
      data: {
        accountId: driver.account.id,
        token: resetToken,
        expiresAt,
      }
    });
    
    // Send reset email
    const emailService = getEmailService();
    try {
      await emailService.sendPasswordResetEmail({
        to: driver.email,
        username: driver.username || driver.fullName || 'User',
        resetToken,
      });
      
      console.log(`[Auth] Password reset email sent to ${driver.email} for username: ${driver.username}`);
    } catch (emailError) {
      console.error('[Auth] Failed to send password reset email:', emailError);
      // Continue even if email fails (return success to prevent enumeration)
    }
    
    res.json({ 
      success: true, 
      message: 'If an account exists with that username/email, a password reset link has been sent.' 
    });
  } catch (err) {
    console.error('auth/forgot-password', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', loginLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token_and_password_required' });
  }
  
  // Validate password
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    return res.status(400).json({ 
      error: 'invalid_password',
      details: passwordValidation.errors 
    });
  }
  
  try {
    // Find reset token
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
      include: {
        account: {
          include: {
            driver: true
          }
        }
      }
    });
    
    if (!resetRecord) {
      return res.status(400).json({ error: 'invalid_or_expired_token' });
    }
    
    if (resetRecord.used) {
      return res.status(400).json({ error: 'token_already_used' });
    }
    
    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({ error: 'token_expired' });
    }
    
    // Hash new password
    const passwordHash = await hashPassword(newPassword);
    
    // Update password
    await prisma.account.update({
      where: { id: resetRecord.accountId },
      data: { passwordHash }
    });
    
    // Mark token as used
    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true }
    });
    
    // Delete all other unused tokens for this account
    await prisma.passwordReset.deleteMany({
      where: {
        accountId: resetRecord.accountId,
        used: false,
        id: { not: resetRecord.id }
      }
    });
    
    // Send success email
    const emailService = getEmailService();
    try {
      await emailService.sendPasswordResetSuccessEmail({
        to: resetRecord.account.driver.email,
        username: resetRecord.account.driver.username || resetRecord.account.driver.fullName || 'User',
      });
    } catch (emailError) {
      console.error('[Auth] Failed to send password reset success email:', emailError);
      // Continue even if email fails
    }
    
    console.log(`[Auth] Password reset successful for account: ${resetRecord.accountId}`);
    
    res.json({ 
      success: true, 
      message: 'Password has been reset successfully. You can now login with your new password.' 
    });
  } catch (err) {
    console.error('auth/reset-password', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/logout - Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    // Clear session on server side if session ID exists
    const cookies = req.headers.cookie ? require('cookie').parse(req.headers.cookie || '') : {};
    const sessionId = cookies[process.env.SESSION_COOKIE_NAME || 'sid'];
    
    if (sessionId) {
      const { destroySession } = require('../sessionStore');
      destroySession(sessionId);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('auth/logout', err);
    res.json({ success: true }); // Always return success
  }
});

module.exports = router;

