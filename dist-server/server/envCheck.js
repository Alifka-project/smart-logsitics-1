"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnv = validateEnv;
const url_1 = require("url");
function requireEnv(varName, minLength = 0) {
    const val = process.env[varName];
    if (!val) {
        throw new Error(`FATAL: Required environment variable ${varName} is missing`);
    }
    if (minLength > 0 && val.length < minLength) {
        throw new Error(`FATAL: ${varName} must be at least ${minLength} characters long`);
    }
}
function validateEnv() {
    // DATABASE_URL is always required
    requireEnv('DATABASE_URL');
    if (process.env.NODE_ENV === 'production') {
        // All secrets required in production with minimum lengths
        requireEnv('JWT_SECRET', 32);
        requireEnv('JWT_REFRESH_SECRET', 32);
        // Warn if SMS provider credentials are missing (non-fatal but important)
        const smsProvider = process.env.SMS_PROVIDER || '';
        if (smsProvider === 'twilio' && !process.env.TWILIO_AUTH_TOKEN) {
            console.warn('WARNING: SMS_PROVIDER=twilio but TWILIO_AUTH_TOKEN is not set — webhook signature verification will fail');
        }
        if (smsProvider === 'd7' && !process.env.D7_API_TOKEN) {
            console.warn('WARNING: SMS_PROVIDER=d7 but D7_API_TOKEN is not set');
        }
        // CORS must be explicitly configured in production
        if (!process.env.CORS_ORIGINS) {
            console.warn('WARNING: CORS_ORIGINS not set in production — all cross-origin requests will be blocked');
        }
        // HTTPS enforcement should be enabled
        if (process.env.ENFORCE_HTTPS !== '1') {
            console.warn('WARNING: ENFORCE_HTTPS is not set to 1 — HTTPS redirect is disabled');
        }
    }
    else {
        // Development: warn about missing secrets but don't exit
        if (!process.env.JWT_SECRET) {
            console.warn('WARNING: JWT_SECRET not set — using insecure development default. Set before deploying.');
        }
    }
    // Validate URL formats when present
    if (process.env.SAP_BASE_URL) {
        try {
            new url_1.URL(process.env.SAP_BASE_URL);
        }
        catch {
            throw new Error('SAP_BASE_URL is not a valid URL');
        }
    }
    if (process.env.FRONTEND_URL) {
        try {
            new url_1.URL(process.env.FRONTEND_URL);
        }
        catch {
            throw new Error('FRONTEND_URL is not a valid URL');
        }
    }
}
