/**
 * Account lockout mechanism to prevent brute force attacks
 * Uses in-memory store (can be migrated to Redis for production)
 */

const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

// In-memory store: { username: { attempts: number, lockedUntil: timestamp, firstAttempt: timestamp } }
const lockoutStore = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of lockoutStore.entries()) {
    if (data.lockedUntil && now > data.lockedUntil) {
      lockoutStore.delete(username);
    } else if (data.firstAttempt && (now - data.firstAttempt) > ATTEMPT_WINDOW * 2) {
      // Clean up entries older than 2 windows
      lockoutStore.delete(username);
    }
  }
}, 5 * 60 * 1000);

function recordFailedAttempt(username) {
  const now = Date.now();
  const entry = lockoutStore.get(username) || {
    attempts: 0,
    firstAttempt: now,
    lockedUntil: null
  };

  // Reset if window expired
  if (now - entry.firstAttempt > ATTEMPT_WINDOW) {
    entry.attempts = 0;
    entry.firstAttempt = now;
  }

  entry.attempts += 1;

  // Lock account if max attempts reached
  if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION;
  }

  lockoutStore.set(username, entry);
  return entry;
}

function recordSuccess(username) {
  // Clear lockout on successful login
  lockoutStore.delete(username);
}

function isLocked(username) {
  const entry = lockoutStore.get(username);
  if (!entry || !entry.lockedUntil) {
    return false;
  }

  const now = Date.now();
  if (now < entry.lockedUntil) {
    return {
      locked: true,
      lockedUntil: entry.lockedUntil,
      remainingMinutes: Math.ceil((entry.lockedUntil - now) / 60000)
    };
  }

  // Lock expired, clean up
  lockoutStore.delete(username);
  return false;
}

function getRemainingAttempts(username) {
  const entry = lockoutStore.get(username);
  if (!entry) {
    return MAX_FAILED_ATTEMPTS;
  }

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    return 0; // Account is locked
  }

  return Math.max(0, MAX_FAILED_ATTEMPTS - entry.attempts);
}

module.exports = {
  recordFailedAttempt,
  recordSuccess,
  isLocked,
  getRemainingAttempts
};

