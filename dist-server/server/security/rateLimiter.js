"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.strictLimiter = exports.apiLimiter = exports.loginLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// Use the forwarded IP when behind a reverse proxy (Vercel, Nginx, etc.)
// This ensures limits are per-client, not per-proxy.
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
}
// Login rate limiter: 5 attempts per 15 minutes per IP.
// Combined with in-database account lockout for defense in depth.
// NOTE: In-memory store resets on process restart (serverless environments).
// For persistent enforcement, back this with Redis via rate-limit-redis.
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: getClientIp,
    handler: (_req, res) => {
        res.status(429).json({
            error: 'too_many_login_attempts',
            message: 'Too many login attempts. Please try again after 15 minutes.',
            retryAfter: 15 * 60,
        });
    },
});
exports.loginLimiter = loginLimiter;
// General API rate limiter: 60 requests per minute per IP.
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
});
exports.apiLimiter = apiLimiter;
// Strict limiter for sensitive operations (password reset, SMS send, etc.)
const strictLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
    handler: (_req, res) => {
        res.status(429).json({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please slow down.',
        });
    },
});
exports.strictLimiter = strictLimiter;
