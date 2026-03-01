const rateLimit = require('express-rate-limit');

// NOTE: Vercel serverless functions are stateless — each invocation may be
// a fresh process, so in-memory rate limiting resets per cold start.
// Limits are intentionally relaxed so legitimate users are not locked out.
// The account-lockout logic in auth.js provides the real brute-force guard.

// Login attempt rate limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                    // 20 attempts per window (stateless env)
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({
      error: 'too_many_login_attempts',
      message: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: 15 * 60
    });
  }
});

// General API rate limiter - more lenient
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for sensitive operations
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  apiLimiter,
  strictLimiter
};

