const crypto = require('crypto');

// Simple in-memory session store. For production use Redis or a DB-backed store.
const SESSIONS = new Map();
const DEFAULT_TTL = 12 * 3600 * 1000; // 12 hours

function makeId() {
  return crypto.randomBytes(24).toString('hex');
}

function makeFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.connection.remoteAddress || '');
  return crypto.createHash('sha256').update(ua + '|' + ip).digest('hex');
}

function createSession(req, payload, ttl = DEFAULT_TTL) {
  const id = makeId();
  const fp = makeFingerprint(req);
  const expiresAt = Date.now() + ttl;
  SESSIONS.set(id, { payload, fp, expiresAt });
  return id;
}

function getSession(req, id) {
  if (!id) return null;
  const entry = SESSIONS.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }
  const fp = makeFingerprint(req);
  if (entry.fp !== fp) return null;
  return entry.payload;
}

function destroySession(id) {
  SESSIONS.delete(id);
}

module.exports = { createSession, getSession, destroySession };
