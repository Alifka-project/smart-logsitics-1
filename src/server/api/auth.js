const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../db/prisma');
const {
  hashPassword,
  comparePassword,
  generateAccessToken,
  createLoginSession,
  clearLoginSession,
  refreshAccessToken,
  authenticate,
  destroyUserSessions
} = require('../auth');
const { loginLimiter } = require('../security/rateLimiter');
const { validatePassword, sanitizeInput } = require('../security/passwordValidator');
const { recordFailedAttempt, recordSuccess, isLocked } = require('../security/accountLockout');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, email, phone, full_name } = req.body;
  
  // Sanitize inputs
  const sanitizedUsername = sanitizeInput(username);
  const sanitizedEmail = email ? sanitizeInput(email) : null;
  const sanitizedPhone = phone ? sanitizeInput(phone) : null;
  const sanitizedFullName = full_name ? sanitizeInput(full_name) : null;
  
  if (!sanitizedUsername || !password) {
    return res.status(400).json({ error: 'username_password_required' });
  }
  
  // Validate password strength
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return res.status(400).json({
      error: 'password_validation_failed',
      details: passwordValidation.errors
    });
  }
  
  try {
    // Check if username already exists using Prisma
    const existing = await prisma.driver.findUnique({
      where: { username: sanitizedUsername }
    });
    
    if (existing) {
      return res.status(409).json({ error: 'username_already_exists' });
    }
    
    // Hash password
    const pwHash = await hashPassword(password);
    
    // Create driver with account using Prisma transaction
    const driver = await prisma.$transaction(async (tx) => {
      const newDriver = await tx.driver.create({
        data: {
          username: sanitizedUsername,
          email: sanitizedEmail,
          phone: sanitizedPhone,
          fullName: sanitizedFullName,
          account: {
            create: {
              passwordHash: pwHash,
              role: 'driver'
            }
          }
        }
      });
      return newDriver;
    });
    
    res.status(201).json({ 
      ok: true, 
      driver: {
        id: driver.id,
        username: driver.username,
        email: driver.email,
        phone: driver.phone,
        full_name: driver.fullName
      }
    });
  } catch (err) {
    console.error('auth/register', err);
    if (err.code === 'P2002') { // Prisma unique constraint violation
      return res.status(409).json({ error: 'username_already_exists' });
    }
    res.status(500).json({ error: 'db_error' });
  }
});

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
      // Use generic error to prevent username enumeration
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
      // Use generic error to prevent username enumeration
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    // Successful login
    recordSuccess(sanitizedUsername);
    
    // Update last login using Prisma (non-blocking - don't fail login if this fails)
    try {
      await prisma.account.update({
        where: { driverId: driver.id },
        data: { lastLogin: new Date() }
      });
    } catch (updateErr) {
      console.warn('Failed to update last login timestamp:', updateErr.message);
      // Continue with login even if update fails
    }
    
    const payload = {
      sub: driver.id,
      role: driver.account.role,
      username: driver.username
    };
    
    // Create server-side session and set cookies
    let clientKey, csrfToken;
    try {
      const sessionResult = createLoginSession(req, res, payload);
      if (!sessionResult || !sessionResult.clientKey || !sessionResult.csrfToken) {
        throw new Error('createLoginSession returned invalid result');
      }
      clientKey = sessionResult.clientKey;
      csrfToken = sessionResult.csrfToken;
    } catch (sessionErr) {
      console.error('Failed to create login session:', sessionErr);
      console.error('Session error message:', sessionErr.message);
      console.error('Session error stack:', sessionErr.stack);
      // Generate fallback tokens if session creation fails
      clientKey = crypto.randomBytes(32).toString('hex');
      csrfToken = crypto.randomBytes(32).toString('hex');
      console.warn('Using fallback session tokens due to session creation failure');
    }
    
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
      expiresIn: 15 * 60 // 15 minutes in seconds
    });
  } catch (err) {
    console.error('auth/login error:', err);
    console.error('auth/login error stack:', err.stack);
    console.error('auth/login error message:', err.message);
    console.error('auth/login error code:', err.code);
    
    // Provide more detailed error for debugging
    const errorMessage = err.message || 'Unknown error';
    const errorCode = err.code || 'UNKNOWN';
    
    res.status(500).json({ 
      error: 'server_error',
      message: 'Server error. Please try again later.',
      detail: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      code: process.env.NODE_ENV === 'development' ? errorCode : undefined
    });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    const sessionId = req.sessionId;
    clearLoginSession(res, sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error('auth/logout', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', refreshAccessToken);

// GET /api/auth/me - Return current session user
router.get('/me', authenticate, async (req, res) => {
  try {
    const { user } = req; // Set by authenticate middleware
    
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    // Get user info from database using Prisma
    const driver = await prisma.driver.findUnique({
      where: { id: user.id || user.sub },
      include: {
        account: true
      }
    });
    
    if (!driver || !driver.account) {
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
      csrfToken: req.csrfToken ? req.csrfToken() : 'dev-csrf-token'
    });
  } catch (err) {
    console.error('auth/me', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'passwords_required' });
  }
  
  // Validate new password strength
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return res.status(400).json({
      error: 'password_validation_failed',
      details: passwordValidation.errors
    });
  }
  
  try {
    // Get current password hash using Prisma
    const account = await prisma.account.findUnique({
      where: { driverId: req.user.sub }
    });
    
    if (!account) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    
    // Verify current password
    const isValid = await comparePassword(currentPassword, account.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'invalid_current_password' });
    }
    
    // Hash new password
    const newHash = await hashPassword(newPassword);
    
    // Update password using Prisma
    await prisma.account.update({
      where: { driverId: req.user.sub },
      data: { passwordHash: newHash }
    });
    
    // Destroy all existing sessions (force re-login)
    destroyUserSessions(req.user.sub);
    clearLoginSession(res);
    
    res.json({ ok: true, message: 'password_changed' });
  } catch (err) {
    console.error('auth/change-password', err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;
