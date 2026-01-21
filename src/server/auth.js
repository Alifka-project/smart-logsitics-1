const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const { createSession, getSession, destroySession, verifyCSRF, rotateSession, destroyUserSessions } = require('./sessionStore');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('⚠️  WARNING: JWT_SECRET not set, using default. Change in production!');
  return 'dev-secret-change-me-in-production';
})();

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (() => {
  console.warn('⚠️  WARNING: JWT_REFRESH_SECRET not set, using default. Change in production!');
  return 'dev-refresh-secret-change-me-in-production';
})();

const ACCESS_TOKEN_EXP = '15m'; // Short-lived access token
const REFRESH_TOKEN_EXP = '7d'; // Longer-lived refresh token
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'sid';
const REFRESH_COOKIE = process.env.REFRESH_COOKIE_NAME || 'rt';

// Password hashing with bcrypt (cost factor 12 for better security)
async function hashPassword(password) {
  return bcrypt.hash(password, 12); // Increased from 10 to 12
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Generate short-lived access token
function generateAccessToken(payload) {
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
function generateRefreshToken(payload) {
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
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (err) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (err) {
    return null;
  }
}

// Create secure login session with both cookies and tokens
function createLoginSession(req, res, payload) {
  const { id: sid, clientKey, csrfToken } = createSession(req, payload);
  
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction, // Only send over HTTPS in production
    sameSite: 'strict', // CSRF protection
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

function clearLoginSession(res, sessionId = null) {
  if (sessionId) {
    destroySession(sessionId);
  }
  
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    cookie.serialize(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    }),
    cookie.serialize(REFRESH_COOKIE, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    })
  ]);
}

// Enhanced authentication middleware with CSRF protection for state-changing operations
function authenticate(req, res, next) {
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
      req.user = decoded;
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
    return res.status(401).json({ error: 'unauthorized', code: 'NO_SESSION' });
  }
  
  console.log(`[Auth] Checking session: ${sid.substring(0, 20)}...`);
  const sessionData = getSession(req, sid);
  if (!sessionData) {
    console.log(`[Auth] ✗ Session not found or expired`);
    return res.status(401).json({ error: 'invalid_session', code: 'SESSION_EXPIRED' });
  }
  
  console.log(`[Auth] ✓ Valid session for user: ${sessionData.payload.sub}`);
  req.user = sessionData.payload;
  req.sessionId = sid;
  req.csrfToken = sessionData.csrfToken;
  req.authMethod = 'session';
  
  return next();
}

// CSRF protection middleware for state-changing operations (POST, PUT, DELETE, PATCH)
function requireCSRF(req, res, next) {
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

  return res.status(403).json({ error: 'csrf_token_required', code: 'CSRF_FAILED' });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized', code: 'NO_USER' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'forbidden', code: 'INSUFFICIENT_PERMISSIONS' });
    }
    return next();
  };
}

// Refresh access token using refresh token
function refreshAccessToken(req, res) {
  const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
  const refreshToken = cookies[REFRESH_COOKIE];
  
  if (!refreshToken) {
    return res.status(401).json({ error: 'no_refresh_token', code: 'NO_REFRESH_TOKEN' });
  }
  
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return res.status(401).json({ error: 'invalid_refresh_token', code: 'INVALID_REFRESH_TOKEN' });
  }
  
  // Generate new access token
  const newPayload = {
    sub: decoded.sub,
    role: decoded.role,
    username: decoded.username
  };
  
  const newAccessToken = generateAccessToken(newPayload);
  
  return res.json({
    accessToken: newAccessToken,
    expiresIn: 15 * 60 // 15 minutes in seconds
  });
}

module.exports = {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  authenticate,
  requireCSRF,
  requireRole,
  createLoginSession,
  clearLoginSession,
  refreshAccessToken,
  destroyUserSessions,
  rotateSession
};
