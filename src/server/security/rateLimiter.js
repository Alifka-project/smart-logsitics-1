const rateLimit = require('express-rate-limit');

// Login attempt rate limiter - strict limits to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: { error: 'too_many_login_attempts', retryAfter: '15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  skipFailedRequests: false,
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

