const crypto = require('crypto');

// Simple in-memory session store. For production use Redis or a DB-backed store.
const SESSIONS = new Map();
const DEFAULT_TTL = 12 * 3600 * 1000; // 12 hours
const DEFAULT_INACTIVITY = 5 * 60 * 1000; // 5 minutes inactivity

function makeId() {
  return crypto.randomBytes(24).toString('hex');
}

function makeClientKey() {
  return crypto.randomBytes(18).toString('hex');
}

function makeFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.connection.remoteAddress || '');
  return crypto.createHash('sha256').update(ua + '|' + ip).digest('hex');
}

function createSession(req, payload, ttl = DEFAULT_TTL) {
  const id = makeId();
  const clientKey = makeClientKey();
  const fp = makeFingerprint(req);
  const now = Date.now();
  const expiresAt = now + ttl;
  SESSIONS.set(id, { payload, fp, expiresAt, clientKey, lastAccess: now });
  return { id, clientKey };
}

function getSession(req, id) {
  if (!id) return null;
  const entry = SESSIONS.get(id);
  if (!entry) return null;
  const now = Date.now();
  if (now > entry.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }
  // inactivity check
  const inactivityLimit = process.env.SESSION_INACTIVITY_MS ? parseInt(process.env.SESSION_INACTIVITY_MS, 10) : DEFAULT_INACTIVITY;
  if (entry.lastAccess && (now - entry.lastAccess) > inactivityLimit) {
    SESSIONS.delete(id);
    return null;
  }
  const fp = makeFingerprint(req);
  if (entry.fp !== fp) return null;
  // client key must be provided by client header
  const clientKey = (req.headers['x-client-key'] || '').toString();
  if (!clientKey || clientKey !== entry.clientKey) return null;
  // update last access
  entry.lastAccess = now;
  SESSIONS.set(id, entry);
  return entry.payload;
}

function destroySession(id) {
  SESSIONS.delete(id);
}

module.exports = { createSession, getSession, destroySession };
