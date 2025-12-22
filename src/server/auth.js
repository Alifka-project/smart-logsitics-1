const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const db = require('./db');
const { createSession, getSession, destroySession } = require('./sessionStore');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXP = '12h';
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'sid';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXP });
}

// New: create server-side session and set cookie via response helper
function createLoginSession(req, res, payload) {
  const { id: sid, clientKey } = createSession(req, payload);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 12 * 3600 * 1000,
  };
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, sid, cookieOptions));
  return clientKey;
}

function clearLoginSession(res) {
  res.setHeader('Set-Cookie', cookie.serialize(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 }));
}

function authenticate(req, res, next) {
  // First try Authorization header (existing JWT flow)
  const h = req.headers.authorization || '';
  const parts = h.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    const token = parts[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err) {
      // fallthrough to cookie-based session
    }
  }

  // Fallback to session cookie
  const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie || '') : {};
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return res.status(401).json({ error: 'unauthorized' });
  const sessionPayload = getSession(req, sid);
  if (!sessionPayload) return res.status(401).json({ error: 'invalid_session' });
  req.user = sessionPayload;
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });
    return next();
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  authenticate,
  requireRole,
  createLoginSession,
  clearLoginSession,
};
