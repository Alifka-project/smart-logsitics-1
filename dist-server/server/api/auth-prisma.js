"use strict";
/**
 * Authentication API using Prisma ORM
 * Database is REQUIRED - All queries use Prisma
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
const prisma = require('../db/prisma').default;
const { hashPassword, comparePassword, generateAccessToken, createLoginSession, } = require('../auth');
const { validatePassword, sanitizeInput } = require('../security/passwordValidator');
const { recordFailedAttempt, recordSuccess, isLocked } = require('../security/accountLockout');
const { loginLimiter } = require('../security/rateLimiter');
const { getEmailService } = require('../services/emailService');
// POST /api/auth/login - with rate limiting and account lockout
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return void res.status(400).json({ error: 'username_password_required' });
    }
    const sanitizedUsername = sanitizeInput(username);
    // Check account lockout
    const lockoutStatus = isLocked(sanitizedUsername);
    if (lockoutStatus) {
        return void res.status(423).json({
            error: 'account_locked',
            message: `Too many failed attempts. Please wait ${lockoutStatus.remainingSeconds} seconds before trying again.`,
            lockedUntil: new Date(lockoutStatus.lockedUntil).toISOString(),
            retryAfterSeconds: lockoutStatus.remainingSeconds,
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
            return void res.status(401).json({ error: 'invalid_credentials' });
        }
        // Check if account is active
        if (!driver.active) {
            return void res.status(403).json({ error: 'account_inactive' });
        }
        // Verify password
        const passwordMatch = await comparePassword(password, driver.account.passwordHash);
        if (!passwordMatch) {
            recordFailedAttempt(sanitizedUsername);
            return void res.status(401).json({ error: 'invalid_credentials' });
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
    }
    catch (err) {
        const e = err;
        console.error('auth/login', err);
        res.status(500).json({ error: 'db_error' });
    }
});
// GET /api/auth/me - Get current user
router.get('/me', async (req, res) => {
    try {
        const { user } = req; // Set by authenticate middleware
        if (!user) {
            return void res.status(401).json({ error: 'unauthorized' });
        }
        // Get driver with account using Prisma
        const driver = await prisma.driver.findUnique({
            where: { id: user.id },
            include: {
                account: true
            }
        });
        if (!driver) {
            return void res.status(401).json({ error: 'user_not_found' });
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
    }
    catch (err) {
        console.error('auth/me', err);
        res.status(500).json({ error: 'db_error' });
    }
});
// NOTE: Forgot/reset password endpoints temporarily disabled in Prisma auth router.
// // POST /api/auth/forgot-password - Request password reset
// router.post('/forgot-password', loginLimiter, async (req, res) => {
//   const { username, email } = req.body;
//   ...
// });
//
// // POST /api/auth/reset-password - Reset password with token
// router.post('/reset-password', loginLimiter, async (req, res) => {
//   const { token, newPassword } = req.body;
//   ...
// });
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
    }
    catch (err) {
        console.error('auth/logout', err);
        res.json({ success: true }); // Always return success
    }
});
exports.default = router;
