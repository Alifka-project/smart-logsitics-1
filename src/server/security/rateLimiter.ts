import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// Use the forwarded IP when behind a reverse proxy (Vercel, Nginx, etc.)
// This ensures limits are per-client, not per-proxy.
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Login rate limiter: 5 attempts per 1 minute per IP.
// Combined with in-memory account lockout for defense in depth.
// NOTE: In-memory store resets on process restart (serverless environments).
// For persistent enforcement, back this with Redis via rate-limit-redis.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 5,                        // 5 login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: getClientIp,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: 'too_many_login_attempts',
      message: 'Too many login attempts. Please wait 1 minute before trying again.',
      retryAfter: 60,
    });
  },
});

// General API rate limiter: 60 requests per minute per IP.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
});

// Strict limiter for sensitive operations (password reset, SMS send, etc.)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: (_req: Request, res: Response): void => {
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please slow down.',
    });
  },
});

export { loginLimiter, apiLimiter, strictLimiter };
