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

// Test endpoint to verify server is working
router.get('/test', (req, res) => {
  res.json({ ok: true, message: 'Auth endpoint is working', timestamp: new Date().toISOString() });
});

// POST /api/auth/login - with rate limiting and account lockout
router.post('/login', loginLimiter, async (req, res) => {
  console.log('=== LOGIN REQUEST RECEIVED ===');
  const { username, password } = req.body;
  
  if (!username || !password) {
    console.log('Missing username or password');
    return res.status(400).json({ error: 'username_password_required' });
  }
  
  const sanitizedUsername = sanitizeInput(username);
  console.log('Login attempt for username:', sanitizedUsername);
  
  // Check account lockout
  const lockoutStatus = isLocked(sanitizedUsername);
  if (lockoutStatus) {
    console.log('Account locked:', sanitizedUsername);
    return res.status(423).json({
      error: 'account_locked',
      message: `Account locked due to too many failed attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
      lockedUntil: new Date(lockoutStatus.lockedUntil).toISOString()
    });
  }
  
  try {
    // Verify Prisma is available
    if (!prisma) {
      console.error('auth/login: Prisma client not initialized');
      return res.status(503).json({ error: 'service_unavailable', message: 'Database service not available' });
    }
    console.log('Prisma client available, querying for user...');
    
    // Find driver with account using Prisma
    let driver;
    try {
      console.log('Executing Prisma query for user:', sanitizedUsername);
      const startTime = Date.now();
      driver = await prisma.driver.findUnique({
        where: { username: sanitizedUsername },
        include: {
          account: true
        }
      });
      const queryTime = Date.now() - startTime;
      console.log('Query result:', driver ? 'User found' : 'User not found', '(' + queryTime + 'ms)');
    } catch (dbErr) {
      console.error('auth/login: Database query error:', dbErr.message);
      console.error('auth/login: Database error code:', dbErr.code);
      console.error('auth/login: Full error:', dbErr);
      console.error('auth/login: Error name:', dbErr.name);
      
      // Handle specific database connection errors
      if (dbErr.code === 'P1000' || dbErr.code === 'ECONNREFUSED' || (dbErr.message && dbErr.message.includes('Can\'t reach database'))) {
        console.error('Database connection issue - unable to reach server');
        return res.status(503).json({ 
          error: 'database_unavailable', 
          message: 'Database service temporarily unavailable. Please try again later.' 
        });
      }
      
      // Handle timeout errors
      if ((dbErr.message && dbErr.message.includes('timeout')) || dbErr.code === 'P1008') {
        console.error('Database connection timeout');
        return res.status(504).json({ 
          error: 'database_timeout', 
          message: 'Database request timeout. Please try again.' 
        });
      }
      
      return res.status(503).json({ error: 'database_error', message: 'Database connection failed. Please try again later.' });
    }
    
    if (!driver || !driver.account) {
      console.log('User not found or no account:', sanitizedUsername);
      recordFailedAttempt(sanitizedUsername);
      // Use generic error to prevent username enumeration
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    console.log('User found. Checking if active...');
    
    // Check if account is active
    if (!driver.active) {
      console.log('Account inactive:', sanitizedUsername);
      return res.status(403).json({ error: 'account_inactive' });
    }
    
    console.log('Account is active. Checking password...');
    
    // Verify password
    let passwordMatch = false;
    try {
      passwordMatch = await comparePassword(password, driver.account.passwordHash);
      console.log('Password check result:', passwordMatch ? 'MATCH' : 'NO MATCH');
    } catch (compareErr) {
      console.error('auth/login: Password comparison error:', compareErr.message);
      console.error('auth/login: Full error:', compareErr);
      return res.status(500).json({ error: 'auth_error', message: 'Authentication service error' });
    }
    
    if (!passwordMatch) {
      console.log('Password does not match for user:', sanitizedUsername);
      recordFailedAttempt(sanitizedUsername);
      // Use generic error to prevent username enumeration
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    
    console.log('✅ LOGIN SUCCESSFUL for:', sanitizedUsername);
    
    // Successful login
    recordSuccess(sanitizedUsername);
    
    // Update last login using Prisma (non-blocking - don't fail login if this fails)
    try {
      await prisma.account.update({
        where: { driverId: driver.id },
        data: { lastLogin: new Date() }
      });
    } catch (updateErr) {
      console.warn('auth/login: Failed to update last login timestamp:', updateErr.message);
      // Continue with login even if update fails
    }
    
    const payload = {
      sub: driver.id,
      role: driver.account.role,
      username: driver.username
    };
    
    // Generate access token first (before session creation)
    let accessToken;
    try {
      accessToken = generateAccessToken(payload);
    } catch (tokenErr) {
      console.error('auth/login: Token generation error:', tokenErr.message);
      return res.status(500).json({ error: 'token_error', message: 'Failed to generate authentication token' });
    }
    
    // Create server-side session and set cookies
    let clientKey, csrfToken;
    try {
      const sessionResult = createLoginSession(req, res, payload);
      if (!sessionResult || !sessionResult.clientKey || !sessionResult.csrfToken) {
        throw new Error('Session creation returned invalid result');
      }
      clientKey = sessionResult.clientKey;
      csrfToken = sessionResult.csrfToken;
    } catch (sessionErr) {
      console.error('auth/login: Session creation error:', sessionErr.message);
      return res.status(500).json({ error: 'session_error', message: 'Failed to create session' });
    }
    
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
    console.error('auth/login error name:', err.name);
    
    // Check if response was already sent
    if (res.headersSent) {
      console.error('Response already sent, cannot send error response');
      return;
    }
    
    // Provide more detailed error for debugging
    const errorMessage = err.message || 'Unknown error';
    const errorCode = err.code || 'UNKNOWN';
    
    // Determine appropriate status code
    let statusCode = 500;
    if (err.message && err.message.includes('Password verification failed')) {
      statusCode = 500; // Server error, not user error
    } else if (err.message && err.message.includes('Token generation failed')) {
      statusCode = 500;
    }
    
    res.status(statusCode).json({ 
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
router.get('/me', async (req, res) => {
  try {
    // Try to get user from authenticate middleware first (if it was applied)
    let user = req.user;
    
    // If no user from middleware, try to extract from Authorization header
    if (!user) {
      const authHeader = req.headers.authorization || '';
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];
        // Import verifyAccessToken
        const { verifyAccessToken } = require('../auth');
        const decoded = verifyAccessToken(token);
        if (decoded) {
          user = decoded;
        }
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    // Get user info from database using Prisma
    const driver = await prisma.driver.findUnique({
      where: { id: user.id || user.sub },
      include: {
        account: true
      }
    }).catch(err => {
      console.error('[auth/me] Prisma query error:', err);
      return null;
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
