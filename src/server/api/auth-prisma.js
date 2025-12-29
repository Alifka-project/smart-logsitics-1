/**
 * Authentication API using Prisma ORM
 * Database is REQUIRED - All queries use Prisma
 */

const express = require('express');
const router = express.Router();
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
    await prisma.driverAccount.update({
      where: { driverId: driver.id },
      data: { lastLogin: new Date() }
    });
    
    const payload = {
      sub: driver.id,
      role: driver.account.role,
      username: driver.username
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
      expiresIn: 15 * 60 // 15 minutes in seconds
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
      csrfToken: req.csrfToken ? req.csrfToken() : 'dev-csrf-token'
    });
  } catch (err) {
    console.error('auth/me', err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;

