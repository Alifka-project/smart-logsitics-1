import { Router, Request, Response } from 'express';
import crypto from 'crypto';
const router = Router();
const prisma = require('../db/prisma').default;
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
const { getEmailService } = require('../services/emailService');

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { username, password, email, phone, full_name } = req.body as {
    username?: string; password?: string; email?: string; phone?: string; full_name?: string;
  };

  // Sanitize inputs
  const sanitizedUsername = sanitizeInput(username);
  const sanitizedEmail = email ? sanitizeInput(email) : null;
  const sanitizedPhone = phone ? sanitizeInput(phone) : null;
  const sanitizedFullName = full_name ? sanitizeInput(full_name) : null;

  if (!sanitizedUsername || !password) {
    return void res.status(400).json({ error: 'username_password_required' });
  }

  // Validate password strength
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    return void res.status(400).json({
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
      return void res.status(409).json({ error: 'username_already_exists' });
    }

    // Hash password
    const pwHash = await hashPassword(password);

    // Create driver with account using Prisma transaction
    const driver = await prisma.$transaction(async (tx: unknown) => {
      const tx_ = tx as { driver: { create: (args: unknown) => Promise<unknown> } };
      const newDriver = await tx_.driver.create({
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

    const d = driver as { id: string; username: string; email?: string; phone?: string; fullName?: string };
    res.status(201).json({
      ok: true,
      driver: {
        id: d.id,
        username: d.username,
        email: d.email,
        phone: d.phone,
        full_name: d.fullName
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string };
    console.error('auth/register', err);
    if (e.code === 'P2002') { // Prisma unique constraint violation
      return void res.status(409).json({ error: 'username_already_exists' });
    }
    res.status(500).json({ error: 'db_error' });
  }
});

// Test endpoint to verify server is working
router.get('/test', (req: Request, res: Response): void => {
  res.json({ ok: true, message: 'Auth endpoint is working', timestamp: new Date().toISOString() });
});

// POST /api/auth/login - with rate limiting and account lockout
router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  console.log('=== LOGIN REQUEST RECEIVED ===');
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    console.log('Missing username or password');
    return void res.status(400).json({ error: 'username_password_required' });
  }

  const sanitizedUsername = sanitizeInput(username);
  console.log('Login attempt for username:', sanitizedUsername);

  // Check account lockout
  const lockoutStatus = isLocked(sanitizedUsername);
  if (lockoutStatus) {
    console.log('Account locked:', sanitizedUsername);
    return void res.status(423).json({
      error: 'account_locked',
      message: `Account locked due to too many failed attempts. Try again in ${lockoutStatus.remainingMinutes} minutes.`,
      lockedUntil: new Date(lockoutStatus.lockedUntil).toISOString()
    });
  }

  try {
    // Verify Prisma is available
    if (!prisma) {
      console.error('auth/login: Prisma client not initialized');
      return void res.status(503).json({ error: 'service_unavailable', message: 'Database service not available' });
    }
    console.log('Prisma client available, querying for user...');

    // Find driver with account using Prisma
    let driver: Record<string, unknown> | null = null;
    try {
      console.log('Executing Prisma query for user:', sanitizedUsername);
      const startTime = Date.now();
      driver = await prisma.driver.findFirst({
        where: { username: { equals: sanitizedUsername, mode: 'insensitive' } },
        include: {
          account: true
        }
      });
      const queryTime = Date.now() - startTime;
      console.log('Query result:', driver ? 'User found' : 'User not found', '(' + queryTime + 'ms)');
    } catch (dbErr: unknown) {
      console.error('auth/login: Database query error:', (dbErr as { message?: string }).message);
      console.error('auth/login: Database error code:', (dbErr as { code?: string }).code);
      console.error('auth/login: Full error:', dbErr);
      console.error('auth/login: Error name:', (dbErr as { name?: string }).name);

      const dbe = dbErr as { code?: string; message?: string };
      // Handle specific database connection errors
      if (dbe.code === 'P1000' || dbe.code === 'ECONNREFUSED' || (dbe.message && dbe.message.includes('Can\'t reach database'))) {
        console.error('Database connection issue - unable to reach server');
        return void res.status(503).json({
          error: 'database_unavailable',
          message: 'Database service temporarily unavailable. Please try again later.'
        });
      }

      // Handle timeout errors
      if ((dbe.message && dbe.message.includes('timeout')) || dbe.code === 'P1008') {
        console.error('Database connection timeout');
        return void res.status(504).json({
          error: 'database_timeout',
          message: 'Database request timeout. Please try again.'
        });
      }

      return void res.status(503).json({ error: 'database_error', message: 'Database connection failed. Please try again later.' });
    }

    const driverRecord = driver as { id?: string; username?: string; fullName?: string; email?: string; phone?: string; profilePicture?: string; active?: boolean; account?: { role?: string; passwordHash?: string } } | null;

    if (!driverRecord || !driverRecord.account) {
      console.log('User not found or no account:', sanitizedUsername);
      recordFailedAttempt(sanitizedUsername);
      // Use generic error to prevent username enumeration
      return void res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    console.log('User found. Checking if active...');

    // Check if account is active
    if (!driverRecord.active) {
      console.log('Account inactive:', sanitizedUsername);
      return void res.status(403).json({ error: 'account_inactive' });
    }

    console.log('Account is active. Checking password...');

    // Verify password
    let passwordMatch = false;
    try {
      passwordMatch = await comparePassword(password, driverRecord.account.passwordHash);
      console.log('Password check result:', passwordMatch ? 'MATCH' : 'NO MATCH');
    } catch (compareErr: unknown) {
      const ce = compareErr as { message?: string };
      console.error('auth/login: Password comparison error:', ce.message);
      console.error('auth/login: Full error:', compareErr);
      return void res.status(500).json({ error: 'auth_error', message: 'Authentication service error' });
    }

    if (!passwordMatch) {
      console.log('Password does not match for user:', sanitizedUsername);
      recordFailedAttempt(sanitizedUsername);
      // Use generic error to prevent username enumeration
      return void res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password.' });
    }

    console.log('✅ LOGIN SUCCESSFUL for:', sanitizedUsername);

    // Successful login
    recordSuccess(sanitizedUsername);

    // Update last login using Prisma (non-blocking - don't fail login if this fails)
    try {
      await prisma.account.update({
        where: { driverId: driverRecord.id },
        data: { lastLogin: new Date() }
      });
    } catch (updateErr: unknown) {
      const ue = updateErr as { message?: string };
      console.warn('auth/login: Failed to update last login timestamp:', ue.message);
      // Continue with login even if update fails
    }

    const payload = {
      sub: driverRecord.id,
      role: driverRecord.account.role,
      username: driverRecord.username
    };

    // Generate access token first (before session creation)
    let accessToken: string;
    try {
      accessToken = generateAccessToken(payload);
    } catch (tokenErr: unknown) {
      const te = tokenErr as { message?: string };
      console.error('auth/login: Token generation error:', te.message);
      return void res.status(500).json({ error: 'token_error', message: 'Failed to generate authentication token' });
    }

    // Create server-side session and set cookies
    let clientKey: string, csrfToken: string;
    try {
      const sessionResult = createLoginSession(req, res, payload);
      if (!sessionResult || !sessionResult.clientKey || !sessionResult.csrfToken) {
        throw new Error('Session creation returned invalid result');
      }
      clientKey = sessionResult.clientKey;
      csrfToken = sessionResult.csrfToken;
    } catch (sessionErr: unknown) {
      const se = sessionErr as { message?: string };
      console.error('auth/login: Session creation error:', se.message);
      return void res.status(500).json({ error: 'session_error', message: 'Failed to create session' });
    }

    res.json({
      driver: {
        id: driverRecord.id,
        username: driverRecord.username,
        full_name: driverRecord.fullName,
        fullName: driverRecord.fullName,
        role: driverRecord.account.role,
        email: driverRecord.email,
        phone: driverRecord.phone,
        profile_picture: driverRecord.profilePicture || null,
        profilePicture: driverRecord.profilePicture || null
      },
      clientKey,
      csrfToken,
      accessToken,
      expiresIn: 60 * 60 // 1 hour in seconds (matches ACCESS_TOKEN_EXP)
    });
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; stack?: string; name?: string };
    console.error('auth/login error:', err);
    console.error('auth/login error stack:', e.stack);
    console.error('auth/login error message:', e.message);
    console.error('auth/login error code:', e.code);
    console.error('auth/login error name:', e.name);

    // Check if response was already sent
    if (res.headersSent) {
      console.error('Response already sent, cannot send error response');
      return;
    }

    // Provide more detailed error for debugging
    const errorMessage = e.message || 'Unknown error';
    const errorCode = e.code || 'UNKNOWN';

    // Determine appropriate status code
    let statusCode = 500;
    if (e.message && e.message.includes('Password verification failed')) {
      statusCode = 500; // Server error, not user error
    } else if (e.message && e.message.includes('Token generation failed')) {
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
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = req.sessionId;
    clearLoginSession(res, sessionId);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('auth/logout', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', refreshAccessToken);

// GET /api/auth/me - Return current session user (requires authenticate)
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      return void res.status(401).json({ error: 'unauthorized' });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: user.id || user.sub },
      include: {
        account: true
      }
    }).catch((err: unknown) => {
      console.error('[auth/me] Prisma query error:', err);
      return null;
    });

    if (!driver || !driver.account) {
      return void res.status(401).json({ error: 'user_not_found' });
    }

    res.json({
      user: {
        id: driver.id,
        username: driver.username,
        full_name: driver.fullName,
        fullName: driver.fullName,
        role: driver.account.role,
        email: driver.email,
        phone: driver.phone,
        profile_picture: driver.profilePicture || null,
        profilePicture: driver.profilePicture || null
      },
      csrfToken: (typeof req.csrfToken === 'string' ? req.csrfToken : null) ?? 'dev-csrf-token'
    });
  } catch (err: unknown) {
    console.error('auth/me', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// PATCH /api/auth/profile - Update current user profile (fullName, email, phone, profilePicture)
router.patch('/profile', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) return void res.status(401).json({ error: 'unauthorized' });
    const driverId = user.id ?? user.sub;
    const { fullName, email, phone, profilePicture } = req.body as {
      fullName?: string; email?: string; phone?: string; profilePicture?: string;
    } || {};
    const updateData: Record<string, string | null> = {};
    if (fullName !== undefined) updateData.fullName = String(fullName).trim() || null;
    if (email !== undefined) updateData.email = String(email).trim() || null;
    if (phone !== undefined) updateData.phone = String(phone).trim() || null;
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture && String(profilePicture).trim() ? String(profilePicture).trim() : null;
    if (Object.keys(updateData).length === 0) return void res.status(400).json({ error: 'no_updates' });
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: updateData,
      include: { account: true }
    });
    res.json({
      user: {
        id: driver.id,
        username: driver.username,
        full_name: driver.fullName,
        fullName: driver.fullName,
        role: driver.account.role,
        email: driver.email,
        phone: driver.phone,
        profile_picture: driver.profilePicture || null,
        profilePicture: driver.profilePicture || null
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('auth/profile', err);
    res.status(500).json({ error: 'db_error', message: e.message });
  }
});

// Generate a strong temporary password that passes the password validator
function generateTemporaryPassword(): string {
  const length = 12;
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specials = '!@#$%^&*()_+-=[]{};:,.<>?';
  const all = upper + lower + numbers + specials;

  function pick(chars: string): string {
    return chars[crypto.randomInt(0, chars.length)];
  }

  const passwordChars: string[] = [
    pick(upper),
    pick(lower),
    pick(numbers),
    pick(specials),
  ];

  for (let i = passwordChars.length; i < length; i += 1) {
    passwordChars.push(pick(all));
  }

  // Shuffle characters
  for (let i = passwordChars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}

// NOTE: Forgot/reset password endpoints temporarily disabled. Logic kept for future use.
// // POST /api/auth/forgot-password - Request password reset
// router.post('/forgot-password', loginLimiter, async (req, res) => {
//   const { username, email } = req.body;
//   if (!username && !email) {
//     return res.status(400).json({ error: 'username_or_email_required' });
//   }
//   try {
//     const where = [];
//     if (username) where.push({ username: sanitizeInput(username) });
//     if (email) where.push({ email: email.toLowerCase().trim() });
//     const driver = await prisma.driver.findFirst({
//       where: where.length ? { OR: where } : {},
//       include: { account: true }
//     });
//     if (!driver || !driver.account) {
//       return res.status(404).json({ error: 'user_not_found', message: 'User not found. Please check the username and try again.' });
//     }
//     if (!driver.email) {
//       return res.status(400).json({ error: 'no_email_configured', message: 'This account does not have an email configured. Contact support.' });
//     }
//
//     // Generate a new temporary password and apply it immediately
//     const temporaryPassword = generateTemporaryPassword();
//     const validation = validatePassword(temporaryPassword);
//     if (!validation.valid) {
//       console.error('Generated temporary password did not pass validation', validation.errors);
//       return res.status(500).json({ error: 'password_generation_failed' });
//     }
//
//     const passwordHash = await hashPassword(temporaryPassword);
//     await prisma.account.update({
//       where: { id: driver.account.id },
//       data: { passwordHash }
//     });
//
//     try {
//       const emailService = getEmailService();
//       await emailService.sendPasswordResetEmail({
//         to: driver.email,
//         username: driver.username || driver.fullName || 'User',
//         temporaryPassword
//       });
//     } catch (emailErr) {
//       console.error('auth/forgot-password: failed to send password email', emailErr);
//       // Still respond success to avoid leaking existence of account
//     }
//     res.json({
//       success: true,
//       message: 'If an account exists with that username/email, new login details have been sent.'
//     });
//   } catch (err) {
//     console.error('auth/forgot-password', err);
//     res.status(500).json({ error: 'db_error' });
//   }
// });
//
// // POST /api/auth/reset-password - Reset password with token
// router.post('/reset-password', loginLimiter, async (req, res) => {
//   const { token, newPassword } = req.body;
//   if (!token || !newPassword) {
//     return res.status(400).json({ error: 'token_and_password_required' });
//   }
//   const passwordValidation = validatePassword(newPassword);
//   if (!passwordValidation.valid) {
//     return res.status(400).json({ error: 'invalid_password', details: passwordValidation.errors });
//   }
//   try {
//     const resetRecord = await prisma.passwordReset.findUnique({
//       where: { token },
//       include: { account: { include: { driver: true } } }
//     });
//     if (!resetRecord) return res.status(400).json({ error: 'invalid_or_expired_token' });
//     if (resetRecord.used) return res.status(400).json({ error: 'token_already_used' });
//     if (new Date() > resetRecord.expiresAt) return res.status(400).json({ error: 'token_expired' });
//     const passwordHash = await hashPassword(newPassword);
//     await prisma.account.update({ where: { id: resetRecord.accountId }, data: { passwordHash } });
//     await prisma.passwordReset.update({ where: { id: resetRecord.id }, data: { used: true } });
//     await prisma.passwordReset.deleteMany({ where: { accountId: resetRecord.accountId, used: false, id: { not: resetRecord.id } } });
//     try {
//       const emailService = getEmailService();
//       await emailService.sendPasswordResetSuccessEmail({
//         to: resetRecord.account.driver.email,
//         username: resetRecord.account.driver.username || resetRecord.account.driver.fullName || 'User'
//       });
//     } catch { /* ignore email send failure */ }
//     res.json({ success: true, message: 'Password has been reset successfully. You can now login with your new password.' });
//   } catch (err) {
//     console.error('auth/reset-password', err);
//     res.status(500).json({ error: 'db_error' });
//   }
// });

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword) {
    return void res.status(400).json({ error: 'passwords_required' });
  }

  // Validate new password strength
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return void res.status(400).json({
      error: 'password_validation_failed',
      details: passwordValidation.errors
    });
  }

  try {
    // Get current password hash using Prisma
    const account = await prisma.account.findUnique({
      where: { driverId: req.user!.sub }
    });

    if (!account) {
      return void res.status(404).json({ error: 'user_not_found' });
    }

    // Verify current password
    const isValid = await comparePassword(currentPassword, account.passwordHash);
    if (!isValid) {
      return void res.status(401).json({ error: 'invalid_current_password' });
    }

    // Hash new password
    const newHash = await hashPassword(newPassword);

    // Update password using Prisma
    await prisma.account.update({
      where: { driverId: req.user!.sub },
      data: { passwordHash: newHash }
    });

    // Destroy all existing sessions (force re-login)
    destroyUserSessions(req.user!.sub);
    clearLoginSession(res);

    res.json({ ok: true, message: 'password_changed' });
  } catch (err: unknown) {
    console.error('auth/change-password', err);
    res.status(500).json({ error: 'db_error' });
  }
});

export default router;
