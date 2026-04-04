import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
dotenv.config();
import helmet from 'helmet';
import cors from 'cors';
import prisma from './db/prisma.js';

const app = express();
const port = process.env.PORT || 4000;

const MESSAGE_RETENTION_DAYS = 30;
const MESSAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function cleanupOldMessages(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await prisma.message.deleteMany({
      where: {
        createdAt: {
          lt: cutoff
        }
      }
    });
    if (result.count > 0) {
      console.log(`[Cleanup] Deleted ${result.count} messages older than ${MESSAGE_RETENTION_DAYS} days.`);
    }
  } catch (error: unknown) {
    const e = error as { message?: string };
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

// Security middlewares — helmet with CSP and HSTS enabled
app.use(helmet({
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

import { authenticate, requireCSRF } from './auth.js';
import { validateEnv } from './envCheck.js';
import { apiLimiter } from './security/rateLimiter.js';

// Rate limiting: use centralized rate limiter
app.use('/api', apiLimiter);

// Enforce simple HTTPS redirect when behind load balancer (X-Forwarded-Proto)
app.use((req: Request, res: Response, next: NextFunction) => {
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
  app.use(cors({
    origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) return callback(null, true);
      if (allowedOriginsFromEnv.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
} else if (process.env.NODE_ENV === 'production') {
  app.use(cors({ origin: false }));
} else {
  app.use(cors({
    origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) return callback(null, true);
      try {
        const url = new URL(origin);
        if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return callback(null, true);
      } catch {
        // fall through
      }
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
}

// Hide implementation details
app.disable('x-powered-by');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Validate critical environment variables at startup
try {
  validateEnv();
} catch (err: unknown) {
  const e = err as { message?: string };
  console.error('Environment validation failed:', e.message);
  process.exit(1);
}

// Public API routes (no auth)
import authRouter from './api/auth.js';
import smsWebhookRouter from './api/smsWebhook.js';
import customerPortalRouter from './api/customerPortal.js';
import smsRouter from './api/sms.js';

app.use('/api/auth', authRouter);
app.use('/api/sms/webhook', smsWebhookRouter);
app.use('/api/customer', customerPortalRouter);

// Public SMS confirmation endpoint (before auth middleware)
app.post('/api/sms/confirm', async (req: Request, res: Response) => {
  return (smsRouter as unknown as Record<string, (req: Request, res: Response) => Promise<void>>).confirm(req, res);
});

// Health check - verify database connection using Prisma
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const prismaClient = (await import('./db/prisma.js')).default;
    if (!prismaClient) {
      return res.status(503).json({ 
        ok: false, 
        database: 'not_initialized', 
        error: 'Prisma client not initialized',
        ts: new Date().toISOString() 
      });
    }

    const startTime = Date.now();
    await prismaClient.$queryRaw`SELECT 1 as connected`;
    const queryTime = Date.now() - startTime;

    res.json({ 
      ok: true, 
      database: 'connected', 
      orm: 'prisma', 
      responseTime: queryTime + 'ms',
      ts: new Date().toISOString() 
    });
  } catch (error: unknown) {
    const e = error as { message?: string; code?: string };
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
app.use('/api', authenticate);

// Apply CSRF protection to state-changing operations
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/auth')) {
    return next();
  }
  requireCSRF(req, res, next);
});

// Mount protected API routes
import driversRouter from './api/drivers.js';
import locationsRouter from './api/locations.js';
import adminDashboardRouter from './api/adminDashboard.js';
import notificationsRouter from './api/notifications.js';
import reportsRouter from './api/reports.js';
import trackingRouter from './api/tracking.js';
import messagesRouter from './api/messages.js';
import adminDeliveriesRouter from './api/adminDeliveries.js';
import aiRouter from './api/ai.js';
import deliveriesRouter from './api/deliveries.js';
import sapRouter from './api/sap.js';
import sapIngestionRouter from './api/sap-ingestion.js';
import routingRouter from './api/routing.js';

app.use('/api/admin/drivers', driversRouter);
app.use('/api/driver', locationsRouter);
app.use('/api/admin/dashboard', adminDashboardRouter);
app.use('/api/admin/notifications', notificationsRouter);
app.use('/api/admin/reports', reportsRouter);
app.use('/api/admin/tracking', trackingRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/admin/deliveries', adminDeliveriesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/deliveries', deliveriesRouter);
app.use('/api/sms', smsRouter);
app.use('/api/sap', sapRouter);
app.use('/api/sap-ingestion', sapIngestionRouter);
app.use('/api/routing', routingRouter);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  cleanupOldMessages();
  setInterval(cleanupOldMessages, MESSAGE_CLEANUP_INTERVAL_MS);
});
