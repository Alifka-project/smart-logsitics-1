"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const prisma_js_1 = __importDefault(require("./db/prisma.js"));
const whatsappApiAdapter_js_1 = require("./sms/whatsappApiAdapter.js");
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
const MESSAGE_RETENTION_DAYS = 30;
const MESSAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
async function cleanupOldMessages() {
    try {
        const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const result = await prisma_js_1.default.message.deleteMany({
            where: {
                createdAt: {
                    lt: cutoff
                }
            }
        });
        if (result.count > 0) {
            console.log(`[Cleanup] Deleted ${result.count} messages older than ${MESSAGE_RETENTION_DAYS} days.`);
        }
    }
    catch (error) {
        const e = error;
        console.error('[Cleanup] Failed to delete old messages:', e.message);
    }
}
// Log startup info — never print secrets or connection strings
console.log('=== SERVER STARTUP ===');
console.log('Node Environment:', process.env.NODE_ENV || 'not set');
console.log('Port:', port);
console.log('Vercel:', process.env.VERCEL ? 'yes' : 'no');
console.log('Database URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET — using insecure dev default');
console.log('========================\n');
(0, whatsappApiAdapter_js_1.logWhatsAppStartupDiagnostics)();
// Security middlewares — helmet with CSP and HSTS enabled
app.use((0, helmet_1.default)({
    // Content Security Policy: restrict sources to same-origin and trusted CDNs
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for React build; tighten further with nonces if possible
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", 'https:'],
            fontSrc: ["'self'", 'data:', 'https:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
    },
    // HTTP Strict Transport Security: force HTTPS for 1 year in production
    hsts: process.env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    // Prevent MIME-type sniffing
    noSniff: true,
    // Deny framing to prevent clickjacking
    frameguard: { action: 'deny' },
    // Hide X-Powered-By (also set below)
    hidePoweredBy: true,
    // Referrer policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
const auth_js_1 = require("./auth.js");
const envCheck_js_1 = require("./envCheck.js");
const rateLimiter_js_1 = require("./security/rateLimiter.js");
// Rate limiting: use centralized rate limiter
app.use('/api', rateLimiter_js_1.apiLimiter);
// Enforce simple HTTPS redirect when behind load balancer (X-Forwarded-Proto)
app.use((req, res, next) => {
    const enforceHttps = process.env.ENFORCE_HTTPS === '1';
    if (enforceHttps && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
});
// CORS: restrict to configured origins or allow localhost in non-production
const rawOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOriginsFromEnv = rawOrigins.length ? rawOrigins : [];
if (allowedOriginsFromEnv.length) {
    app.use((0, cors_1.default)({
        origin: function (origin, callback) {
            if (!origin)
                return callback(null, true);
            if (allowedOriginsFromEnv.indexOf(origin) !== -1)
                return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        optionsSuccessStatus: 200,
    }));
}
else if (process.env.NODE_ENV === 'production') {
    app.use((0, cors_1.default)({ origin: false }));
}
else {
    app.use((0, cors_1.default)({
        origin: function (origin, callback) {
            if (!origin)
                return callback(null, true);
            try {
                const url = new URL(origin);
                if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
                    return callback(null, true);
            }
            catch {
                // fall through
            }
            return callback(new Error('Not allowed by CORS'));
        },
        optionsSuccessStatus: 200,
    }));
}
// Hide implementation details
app.disable('x-powered-by');
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
// Validate critical environment variables at startup
try {
    (0, envCheck_js_1.validateEnv)();
}
catch (err) {
    const e = err;
    console.error('Environment validation failed:', e.message);
    process.exit(1);
}
// Public API routes (no auth)
const auth_js_2 = __importDefault(require("./api/auth.js"));
const smsWebhook_js_1 = __importDefault(require("./api/smsWebhook.js"));
const customerPortal_js_1 = __importDefault(require("./api/customerPortal.js"));
const sms_js_1 = __importDefault(require("./api/sms.js"));
const ingest_js_1 = __importDefault(require("./api/ingest.js"));
app.use('/api/auth', auth_js_2.default);
app.use('/api/sms/webhook', smsWebhook_js_1.default);
app.use('/api/customer', customerPortal_js_1.default);
// Auto-ingest endpoint uses its own API-key auth; mounted before session middleware
// so Power Automate / OneDrive callers without a session cookie can reach it.
// Disabled by default — set INGEST_ENABLED=true to activate.
app.use('/api/ingest', ingest_js_1.default);
// Public SMS confirmation endpoint (before auth middleware)
app.post('/api/sms/confirm', async (req, res) => {
    return sms_js_1.default.confirm(req, res);
});
// Health check - verify database connection using Prisma
app.get('/api/health', async (req, res) => {
    try {
        const prismaClient = (await Promise.resolve().then(() => __importStar(require('./db/prisma.js')))).default;
        if (!prismaClient) {
            return res.status(503).json({
                ok: false,
                database: 'not_initialized',
                error: 'Prisma client not initialized',
                ts: new Date().toISOString()
            });
        }
        const startTime = Date.now();
        await prismaClient.$queryRaw `SELECT 1 as connected`;
        const queryTime = Date.now() - startTime;
        res.json({
            ok: true,
            database: 'connected',
            orm: 'prisma',
            responseTime: queryTime + 'ms',
            ts: new Date().toISOString()
        });
    }
    catch (error) {
        const e = error;
        // Log full details server-side only — never expose DB errors to clients
        console.error('Health check failed:', e.message, e.code);
        res.status(503).json({
            ok: false,
            database: 'disconnected',
            ts: new Date().toISOString()
        });
    }
});
// Protect all other /api routes with authentication
app.use('/api', auth_js_1.authenticate);
// Apply CSRF protection to state-changing operations
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) {
        return next();
    }
    (0, auth_js_1.requireCSRF)(req, res, next);
});
// Mount protected API routes
const drivers_js_1 = __importDefault(require("./api/drivers.js"));
const locations_js_1 = __importDefault(require("./api/locations.js"));
const adminDashboard_js_1 = __importDefault(require("./api/adminDashboard.js"));
const notifications_js_1 = __importDefault(require("./api/notifications.js"));
const reports_js_1 = __importDefault(require("./api/reports.js"));
const tracking_js_1 = __importDefault(require("./api/tracking.js"));
const messages_js_1 = __importDefault(require("./api/messages.js"));
const adminDeliveries_js_1 = __importDefault(require("./api/adminDeliveries.js"));
const ai_js_1 = __importDefault(require("./api/ai.js"));
const deliveries_js_1 = __importDefault(require("./api/deliveries.js"));
const sap_js_1 = __importDefault(require("./api/sap.js"));
const sap_ingestion_js_1 = __importDefault(require("./api/sap-ingestion.js"));
const routing_js_1 = __importDefault(require("./api/routing.js"));
app.use('/api/admin/drivers', drivers_js_1.default);
app.use('/api/driver', locations_js_1.default);
app.use('/api/admin/dashboard', adminDashboard_js_1.default);
app.use('/api/admin/notifications', notifications_js_1.default);
app.use('/api/admin/reports', reports_js_1.default);
app.use('/api/admin/tracking', tracking_js_1.default);
app.use('/api/messages', messages_js_1.default);
app.use('/api/admin/deliveries', adminDeliveries_js_1.default);
app.use('/api/ai', ai_js_1.default);
app.use('/api/deliveries', deliveries_js_1.default);
app.use('/api/sms', sms_js_1.default);
app.use('/api/sap', sap_js_1.default);
app.use('/api/sap-ingestion', sap_ingestion_js_1.default);
app.use('/api/routing', routing_js_1.default);
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    cleanupOldMessages();
    setInterval(cleanupOldMessages, MESSAGE_CLEANUP_INTERVAL_MS);
});
