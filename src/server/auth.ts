import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';
import { Request, Response, NextFunction } from 'express';
import { createSession, getSession, destroySession, verifyCSRF, rotateSession, destroyUserSessions } from './sessionStore';

declare global {
  namespace Express {
    interface Request {
      user?: Record<string, unknown>;
      authMethod?: string;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

interface TokenPayload {
  sub?: string;
  role?: string;
  username?: string;
  account?: { role?: string };
  type?: string;
  iat?: number;
  [key: string]: unknown;
}

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('⚠️  WARNING: JWT_SECRET not set, using default. Change in production!');
  return 'dev-secret-change-me-in-production';
})();

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (() => {
  console.warn('⚠️  WARNING: JWT_REFRESH_SECRET not set, using default. Change in production!');
  return 'dev-refresh-secret-change-me-in-production';
})();

const ACCESS_TOKEN_EXP = '1h'; // Access token - increased for serverless cold starts
const REFRESH_TOKEN_EXP = '7d'; // Longer-lived refresh token
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'sid';
const REFRESH_COOKIE = process.env.REFRESH_COOKIE_NAME || 'rt';

// Password hashing with bcrypt (cost factor 12 for better security)
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12); // Increased from 10 to 12
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate short-lived access token
function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(
    {
      ...payload,
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXP }
  );
}

// Generate long-lived refresh token
function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(
    {
      ...payload,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    },
    REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXP }
  );
}

// Verify access token
function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (err: unknown) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as TokenPayload;
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (err: unknown) {
    return null;
  }
}

// Create secure login session with both cookies and tokens
function createLoginSession(req: Request, res: Response, payload: TokenPayload): { clientKey: string; csrfToken: string } {
  const { id: sid, clientKey, csrfToken } = createSession(req, payload);

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions: cookie.SerializeOptions = {
    httpOnly: true,
    secure: isProduction, // Only send over HTTPS in production
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: 12 * 3600, // 12 hours in seconds
  };

  // Set session cookie
  res.setHeader('Set-Cookie', [
    cookie.serialize(SESSION_COOKIE, sid, cookieOptions),
    // Also set refresh token as HttpOnly cookie
    cookie.serialize(REFRESH_COOKIE, generateRefreshToken(payload), {
      ...cookieOptions,
      maxAge: 7 * 24 * 3600 // 7 days
    })
  ]);

  return { clientKey, csrfToken };
}

function clearLoginSession(res: Response, sessionId: string | null = null): void {
  if (sessionId) {
    destroySession(sessionId);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    cookie.serialize(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
      maxAge: 0
    }),
    cookie.serialize(REFRESH_COOKIE, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
      maxAge: 0
    })
  ]);
}

// Enhanced authentication middleware with CSRF protection for state-changing operations
function authenticate(req: Request, res: Response, next: NextFunction): void {
  // First try Authorization header (JWT access token)
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');

  console.log(`[Auth] authenticate() called for ${req.method} ${req.path}`);
  console.log(`[Auth] Authorization header: ${authHeader ? authHeader.substring(0, 30) + '...' : 'NOT PROVIDED'}`);

  if (parts.length === 2 && parts[0] === 'Bearer') {
    const token = parts[1];
    const decoded = verifyAccessToken(token);
    if (decoded) {
      console.log(`[Auth] ✓ Valid JWT token for user: ${decoded.sub}`);
      req.user = decoded as Record<string, unknown>;
      req.authMethod = 'jwt';
      return next();
    } else {
      console.log(`[Auth] ✗ Invalid/expired JWT token`);
    }
  }

  // Fallback to session cookie
  const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
  const sid = cookies[SESSION_COOKIE];

  if (!sid) {
    console.log(`[Auth] ✗ No session cookie found`);
    res.status(401).json({ error: 'unauthorized', code: 'NO_SESSION' });
    return;
  }

  console.log(`[Auth] Checking session: ${sid.substring(0, 20)}...`);
  const sessionData = getSession(req, sid);
  if (!sessionData) {
    console.log(`[Auth] ✗ Session not found or expired`);
    res.status(401).json({ error: 'invalid_session', code: 'SESSION_EXPIRED' });
    return;
  }

  console.log(`[Auth] ✓ Valid session for user: ${sessionData.payload.sub}`);
  req.user = sessionData.payload as Record<string, unknown>;
  req.sessionId = sid;
  req.csrfToken = sessionData.csrfToken;
  req.authMethod = 'session';

  return next();
}

// CSRF protection middleware for state-changing operations (POST, PUT, DELETE, PATCH)
function requireCSRF(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (req.authMethod === 'jwt') {
    // JWT tokens don't need CSRF (they're in Authorization header)
    return next();
  }

  if (req.authMethod === 'session' && req.sessionId) {
    if (verifyCSRF(req, req.sessionId)) {
      return next();
    }
  }

  res.status(403).json({ error: 'csrf_token_required', code: 'CSRF_FAILED' });
}

function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized', code: 'NO_USER' });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: 'forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      return;
    }
    return next();
  };
}

// Helper to require any of the specified roles
function requireAnyRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized', code: 'NO_USER' });
      return;
    }
    const account = req.user.account as { role?: string } | undefined;
    const userRole = (account?.role || req.user.role) as string | undefined;
    if (!userRole || !roles.includes(userRole)) {
      console.log(`[Auth] User role "${userRole}" not in allowed roles:`, roles);
      res.status(403).json({ error: 'forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
      return;
    }
    return next();
  };
}

// Refresh access token using refresh token
function refreshAccessToken(req: Request, res: Response): void {
  const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
  const refreshToken = cookies[REFRESH_COOKIE];

  if (!refreshToken) {
    res.status(401).json({ error: 'no_refresh_token', code: 'NO_REFRESH_TOKEN' });
    return;
  }

  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    res.status(401).json({ error: 'invalid_refresh_token', code: 'INVALID_REFRESH_TOKEN' });
    return;
  }

  // Generate new access token
  const newPayload: TokenPayload = {
    sub: decoded.sub,
    role: decoded.role,
    username: decoded.username
  };

  const newAccessToken = generateAccessToken(newPayload);

  res.json({
    accessToken: newAccessToken,
    expiresIn: 60 * 60 // 1 hour in seconds
  });
}

export {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  authenticate,
  requireCSRF,
  requireRole,
  requireAnyRole,
  createLoginSession,
  clearLoginSession,
  refreshAccessToken,
  destroyUserSessions,
  rotateSession
};
