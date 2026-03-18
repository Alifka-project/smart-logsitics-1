import crypto from 'crypto';
import { Request } from 'express';

// Enhanced in-memory session store with CSRF protection
// For production, migrate to Redis or DB-backed store

export interface SessionPayload {
  sub?: string;
  id?: string;
  username?: string;
  role?: string;
  account?: { role?: string };
  [key: string]: unknown;
}

interface SessionEntry {
  payload: SessionPayload;
  fp: string;
  csrfToken: string;
  expiresAt: number;
  clientKey: string;
  lastAccess: number;
  createdAt: number;
  ip: string;
}

interface ActiveSessionInfo {
  id: string;
  userId: string | undefined;
  username: string | undefined;
  role: string | undefined;
  createdAt: number;
  lastAccess: number;
  ip: string;
}

const SESSIONS = new Map<string, SessionEntry>();
const DEFAULT_TTL = 12 * 3600 * 1000; // 12 hours
const DEFAULT_INACTIVITY = 15 * 60 * 1000; // 15 minutes inactivity
const MAX_CONCURRENT_SESSIONS = 5; // Max sessions per user

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of SESSIONS.entries()) {
    if (now > entry.expiresAt ||
        (entry.lastAccess && (now - entry.lastAccess) > DEFAULT_INACTIVITY)) {
      SESSIONS.delete(id);
    }
  }
}, 5 * 60 * 1000);

function makeId(): string {
  return crypto.randomBytes(32).toString('hex'); // Increased from 24 to 32 for better security
}

function makeClientKey(): string {
  return crypto.randomBytes(32).toString('hex'); // Increased from 18 to 32
}

function makeCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function makeFingerprint(req: Request): string {
  try {
    const ua = req.headers['user-agent'] || '';
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
      : (req.socket?.remoteAddress || req.ip || '');
    const acceptLang = req.headers['accept-language'] || '';
    // More comprehensive fingerprinting
    return crypto.createHash('sha256')
      .update(`${ua}|${ip}|${acceptLang}`)
      .digest('hex');
  } catch (err: unknown) {
    const e = err as Error;
    // Fallback if fingerprinting fails
    console.warn('Fingerprint generation failed:', e.message);
    return crypto.randomBytes(32).toString('hex');
  }
}

function createSession(req: Request, payload: SessionPayload, ttl: number = DEFAULT_TTL): { id: string; clientKey: string; csrfToken: string } {
  const id = makeId();
  const clientKey = makeClientKey();
  const csrfToken = makeCSRFToken();
  const fp = makeFingerprint(req);
  const now = Date.now();
  const expiresAt = now + ttl;
  const userId = payload.sub || payload.id;

  // Enforce concurrent session limit
  if (userId) {
    const userSessions = Array.from(SESSIONS.values())
      .filter(s => (s.payload.sub || s.payload.id) === userId);

    if (userSessions.length >= MAX_CONCURRENT_SESSIONS) {
      // Remove oldest session
      const oldest = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
      const oldestId = Array.from(SESSIONS.entries())
        .find(([_, s]) => s === oldest)?.[0];
      if (oldestId) {
        SESSIONS.delete(oldestId);
      }
    }
  }

  // Safely extract IP address (works in both traditional and serverless environments)
  let ip = 'unknown';
  try {
    const forwarded = req.headers['x-forwarded-for'];
    ip = (forwarded
      ? (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim()
      : (req.socket?.remoteAddress || req.ip || 'unknown'));
  } catch (err: unknown) {
    // Ignore IP extraction errors
  }

  SESSIONS.set(id, {
    payload,
    fp,
    csrfToken,
    expiresAt,
    clientKey,
    lastAccess: now,
    createdAt: now,
    ip
  });

  return { id, clientKey, csrfToken };
}

function getSession(req: Request, id: string): { payload: SessionPayload; csrfToken: string } | null {
  if (!id) return null;
  const entry = SESSIONS.get(id);
  if (!entry) return null;

  const now = Date.now();

  // Check expiration
  if (now > entry.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }

  // Check inactivity timeout
  const inactivityLimit = process.env.SESSION_INACTIVITY_MS
    ? parseInt(process.env.SESSION_INACTIVITY_MS, 10)
    : DEFAULT_INACTIVITY;
  if (entry.lastAccess && (now - entry.lastAccess) > inactivityLimit) {
    SESSIONS.delete(id);
    return null;
  }

  // Verify fingerprint
  const fp = makeFingerprint(req);
  if (entry.fp !== fp) {
    // Fingerprint mismatch - potential session hijacking
    // Log and invalidate session
    console.warn(`Session fingerprint mismatch for session ${id.substring(0, 8)}...`);
    SESSIONS.delete(id);
    return null;
  }

  // Verify client key
  const clientKeyHeader = req.headers['x-client-key'];
  const clientKey = (Array.isArray(clientKeyHeader) ? clientKeyHeader[0] : clientKeyHeader || '').toString();
  if (!clientKey || clientKey !== entry.clientKey) {
    return null;
  }

  // Update last access
  entry.lastAccess = now;
  SESSIONS.set(id, entry);

  return {
    payload: entry.payload,
    csrfToken: entry.csrfToken
  };
}

function verifyCSRF(req: Request, sessionId: string): boolean {
  const entry = SESSIONS.get(sessionId);
  if (!entry) return false;

  const csrfToken = req.headers['x-csrf-token'] || (req.body as Record<string, unknown>)?.csrfToken;
  return csrfToken === entry.csrfToken;
}

function rotateSession(req: Request, oldSessionId: string): { id: string; clientKey: string; csrfToken: string } | null {
  const oldEntry = SESSIONS.get(oldSessionId);
  if (!oldEntry) return null;

  // Create new session with same payload
  const newSession = createSession(req, oldEntry.payload);

  // Delete old session
  SESSIONS.delete(oldSessionId);

  return newSession;
}

function destroySession(id: string): void {
  SESSIONS.delete(id);
}

function destroyUserSessions(userId: string): void {
  // Destroy all sessions for a user (e.g., on password change)
  for (const [id, entry] of SESSIONS.entries()) {
    if ((entry.payload.sub || entry.payload.id) === userId) {
      SESSIONS.delete(id);
    }
  }
}

function getSessionInfo(sessionId: string): { createdAt: number; lastAccess: number; expiresAt: number; ip: string } | null {
  const entry = SESSIONS.get(sessionId);
  if (!entry) return null;

  return {
    createdAt: entry.createdAt,
    lastAccess: entry.lastAccess,
    expiresAt: entry.expiresAt,
    ip: entry.ip
  };
}

// Get all active sessions for admin monitoring
function getAllActiveSessions(): ActiveSessionInfo[] {
  const now = Date.now();
  const activeSessions: ActiveSessionInfo[] = [];

  for (const [id, entry] of SESSIONS.entries()) {
    // Check if session is still valid
    if (now <= entry.expiresAt) {
      const inactivityLimit = process.env.SESSION_INACTIVITY_MS
        ? parseInt(process.env.SESSION_INACTIVITY_MS, 10)
        : DEFAULT_INACTIVITY;

      // Check if session is within inactivity limit
      if (!entry.lastAccess || (now - entry.lastAccess) <= inactivityLimit) {
        activeSessions.push({
          id,
          userId: entry.payload?.sub || entry.payload?.id,
          username: entry.payload?.username,
          role: entry.payload?.role,
          createdAt: entry.createdAt,
          lastAccess: entry.lastAccess || entry.createdAt,
          ip: entry.ip
        });
      }
    }
  }

  return activeSessions;
}

export {
  createSession,
  getSession,
  destroySession,
  destroyUserSessions,
  verifyCSRF,
  rotateSession,
  getSessionInfo,
  getAllActiveSessions
};
