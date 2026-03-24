/**
 * Vercel Serverless Function Entry Point
 * Database is REQUIRED - This exports the Express app for Vercel serverless deployment
 * All endpoints require PostgreSQL database connection
 * Build: 2026-02-02
 */

// ── CRITICAL: Set real DB credentials FIRST, before any require() or dotenv. ──
// Vercel dashboard may inject a fake/wrong DATABASE_URL at the process level.
// Hardcoding here is the only 100%-reliable override because it runs before
// any module is loaded and before Prisma reads the env.
const _REAL_DB = 'postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require';
process.env.DATABASE_URL       = _REAL_DB;
process.env.POSTGRES_URL       = _REAL_DB;
process.env.JWT_SECRET         = process.env.JWT_SECRET         || '7fa46272b50e27646019586e8b56e96392d0e121cb8721ada1570549b06b2281ccdc1355393a33206d352734f24cb0fbafc69ead99638e070d14b7a2b9f3aeb2';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '704dc930bed601acfe5a6d43acc594a0d2c331f6c399db8d5dc4f1555da3e3dbd7f1c8d807d9ccd6fbfd604440327cd70746f5a915c144251631a1b0a9a1e8a2';
process.env.SMS_PROVIDER       = process.env.SMS_PROVIDER       || 'd7';
process.env.D7_ORIGINATOR      = process.env.D7_ORIGINATOR      || 'Electrolux';
process.env.FRONTEND_URL       = process.env.FRONTEND_URL       || 'https://electrolux-smart-portal.vercel.app';
process.env.CORS_ORIGINS       = process.env.CORS_ORIGINS       || 'https://electrolux-smart-portal.vercel.app';
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const rootDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') }); // loads .env for local dev
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4000;

// CORS - Allow all origins for Vercel deployment (include x-client-key for auth)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Client-Key', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Handle preflight so OPTIONS never returns 405
app.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Client-Key, Cookie');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.status(204).end();
});

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: false
}));

// Server modules — compiled TypeScript (dist-server/)
const { authenticate, requireCSRF } = require('../dist-server/server/auth');
const { validateEnv } = require('../dist-server/server/envCheck');
const { apiLimiter } = require('../dist-server/server/security/rateLimiter');

// Rate limiting
app.use(apiLimiter);

app.disable('x-powered-by');
// Allow larger payloads for POD (photos as base64)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.path}`);
  console.log('[REQUEST] URL:', req.url);
  console.log('[REQUEST] Original URL:', req.originalUrl);
  console.log('[REQUEST] Base URL:', req.baseUrl);
  console.log('[REQUEST] Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

// Health check - MUST BE FIRST, before any middleware
app.get('/health', async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(503).json({ 
        ok: false, 
        database: 'disconnected', 
        error: 'DATABASE_URL not set',
        ts: new Date().toISOString() 
      });
    }

    const prisma = require('../dist-server/server/db/prisma').default;

    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected', orm: 'prisma', ts: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'disconnected', error: error.message, ts: new Date().toISOString() });
  }
});

// Validate environment - DATABASE IS REQUIRED
try {
  validateEnv();
  // Verify database connection is configured
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error('ERROR: DATABASE_URL or POSTGRES_URL environment variable is REQUIRED');
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('PRISMA')));
  }
} catch (e) {
  console.error('Environment validation failed:', e.message);
  // Don't exit in serverless - let it fail on first request
}

// Auto-migration: add any missing columns at startup (idempotent — uses IF NOT EXISTS)
(async () => {
  try {
    const prisma = require('../dist-server/server/db/prisma').default;
    await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_url" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_type" VARCHAR(100);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_name" VARCHAR(255);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ALTER COLUMN "content" SET DEFAULT '';`);
    console.log('[startup-migration] messages attachment columns: ok');
  } catch (e) {
    console.warn('[startup-migration] messages attachment columns skipped:', e.message);
  }
})();

// Public API routes (all require database)
app.use('/auth', require('../dist-server/server/api/auth').default);
app.use('/sms/webhook', require('../dist-server/server/api/smsWebhook').default);
app.use('/customer', require('../dist-server/server/api/customerPortal').default);

// Migration endpoint (ONE TIME USE - remove after migration)
app.use('/migrate', require('../dist-server/server/api/migrate').default);

// Safe schema patch — adds any missing tables/columns without dropping data
// Call POST /api/apply-pending-migrations once after deploy, then it's a no-op
app.post('/apply-pending-migrations', async (req, res) => {
  try {
    const prisma = require('../dist-server/server/db/prisma').default;
    const results = [];

    // 1. admin_notifications table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "admin_notifications" (
          "id"         BIGSERIAL       NOT NULL,
          "type"       VARCHAR(64)     NOT NULL,
          "title"      VARCHAR(255)    NOT NULL,
          "message"    TEXT            NOT NULL,
          "payload"    JSONB,
          "is_read"    BOOLEAN         NOT NULL DEFAULT false,
          "created_at" TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_admin_notif_unread" ON "admin_notifications"("is_read", "created_at" DESC);`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_admin_notif_created" ON "admin_notifications"("created_at" DESC);`);
      results.push({ migration: 'add_admin_notifications', status: 'ok' });
    } catch (e) {
      results.push({ migration: 'add_admin_notifications', status: 'error', detail: e.message });
    }

    // 2. poNumber column on deliveries
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "poNumber" varchar(100);`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_delivery_po_number" ON "deliveries"("poNumber");`);
      results.push({ migration: 'add_po_number_column', status: 'ok' });
    } catch (e) {
      results.push({ migration: 'add_po_number_column', status: 'error', detail: e.message });
    }

    // 3. attachment columns on messages
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_url" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_type" VARCHAR(100);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_name" VARCHAR(255);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "messages" ALTER COLUMN "content" SET DEFAULT '';`);
      results.push({ migration: 'add_message_attachments', status: 'ok' });
    } catch (e) {
      results.push({ migration: 'add_message_attachments', status: 'error', detail: e.message });
    }

    const allOk = results.every(r => r.status === 'ok');
    return res.status(allOk ? 200 : 207).json({ ok: allOk, results });
  } catch (err) {
    console.error('[apply-pending-migrations] Fatal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/sms/confirm', async (req, res) => {
  const smsRouter = require('../dist-server/server/api/sms').default;
  return smsRouter.confirm(req, res);
});

// Cache for diagnostic status
let diagCache = null;
let diagCacheTime = 0;
const DIAG_CACHE_TTL = 60000; // 1 minute cache

// Diagnostic endpoint - check data and database status
app.get('/diag/status', async (req, res) => {
  try {
    // Check cache first for basic health check
    const now = Date.now();
    if (diagCache && (now - diagCacheTime) < DIAG_CACHE_TTL && !req.query.detailed) {
      return res.json({ ...diagCache, cached: true });
    }

    const prisma = require('../dist-server/server/db/prisma').default;
    if (!prisma) {
      return res.status(503).json({
        ok: false,
        database: 'not_initialized',
        error: 'Prisma client not initialized',
        detail: 'DATABASE_URL may not be set or connection failed',
        ts: new Date().toISOString()
      });
    }
    
    // Test connection first (lightweight query)
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (connError) {
      return res.status(503).json({
        ok: false,
        database: 'connection_failed',
        error: connError.message,
        code: connError.code,
        detail: 'Cannot reach database server',
        ts: new Date().toISOString()
      });
    }
    
    // For basic health check, just return connection status
    if (!req.query.detailed) {
      const basicResponse = {
        ok: true,
        database: 'connected',
        ts: new Date().toISOString()
      };
      
      // Cache basic response
      diagCache = basicResponse;
      diagCacheTime = Date.now();
      
      return res.json(basicResponse);
    }
    
    // For detailed check (when ?detailed=true), count records
    const deliveryCount = await prisma.delivery.count();
    const smsLogCount = await prisma.smsLog.count();
    const driverCount = await prisma.driver.count();
    const assignmentCount = await prisma.deliveryAssignment.count();
    
    // Get sample delivery if exists
    const sampleDelivery = await prisma.delivery.findFirst({
      select: {
        id: true,
        customer: true,
        status: true,
        createdAt: true
      }
    });
    
    const detailedResponse = {
      ok: true,
      database: 'connected',
      data: {
        deliveries: deliveryCount,
        smsLogs: smsLogCount,
        drivers: driverCount,
        assignments: assignmentCount,
        sampleDelivery: sampleDelivery || null
      },
      ts: new Date().toISOString()
    };
    
    // Cache detailed response
    diagCache = detailedResponse;
    diagCacheTime = Date.now();
    
    res.json(detailedResponse);
  } catch (error) {
    console.error('[Diag] Error:', error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
      code: error.code,
      ts: new Date().toISOString()
    });
  }
});


// Protect all other routes - EXCEPT public endpoints
app.use((req, res, next) => {
  // Allow public routes without authentication
  if (req.path.startsWith('/customer/') || 
      req.path.startsWith('/auth/') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/diag/') ||
      req.path.startsWith('/sms/webhook')) {
    return next();
  }
  // Require authentication for all other routes
  authenticate(req, res, next);
});

app.use((req, res, next) => {
  // Skip CSRF for public routes
  if (req.path.startsWith('/auth') ||
      req.path.startsWith('/customer/') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/diag/') ||
      req.path.startsWith('/sms/webhook')) {
    return next();
  }
  requireCSRF(req, res, next);
});

function resolveDriverIdFromAuth(req) {
  const user = req.user || {};
  return user.sub || user.id || null;
}

// Hotfix endpoints for production tracking reliability.
// Keep here (tracked file) because dist-server is gitignored in this repo.
app.get('/driver/me/live', async (req, res) => {
  try {
    const driverId = resolveDriverIdFromAuth(req);
    if (!driverId) return res.status(401).json({ error: 'unauthorized' });

    const prisma = require('../dist-server/server/db/prisma').default;
    const latest = await prisma.liveLocation.findFirst({
      where: { driverId },
      orderBy: { recordedAt: 'desc' },
      select: {
        driverId: true,
        latitude: true,
        longitude: true,
        recordedAt: true,
        speed: true,
        accuracy: true,
        heading: true
      }
    });

    if (!latest) return res.status(404).json({ error: 'not_found' });

    return res.json({
      driver_id: latest.driverId,
      latitude: latest.latitude,
      longitude: latest.longitude,
      recorded_at: latest.recordedAt,
      speed: latest.speed,
      accuracy: latest.accuracy,
      heading: latest.heading
    });
  } catch (err) {
    console.error('[hotfix] GET /driver/me/live failed:', err);
    return res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

app.post('/driver/me/location', async (req, res) => {
  try {
    const driverId = resolveDriverIdFromAuth(req);
    if (!driverId) return res.status(401).json({ error: 'unauthorized' });

    const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat_long_required' });
    }

    const prisma = require('../dist-server/server/db/prisma').default;
    const created = await prisma.liveLocation.create({
      data: {
        driverId,
        latitude: lat,
        longitude: lng,
        heading: heading != null ? Number(heading) : null,
        speed: speed != null ? Number(speed) : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        recordedAt: recorded_at ? new Date(recorded_at) : new Date()
      }
    });

    // Keep table bounded and refresh tracking cache.
    setTimeout(async () => {
      try {
        await prisma.liveLocation.deleteMany({
          where: {
            driverId,
            recordedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });
      } catch (cleanupErr) {
        console.error('[hotfix] live_locations cleanup failed:', cleanupErr);
      }
    }, 0);

    try {
      const cache = require('../dist-server/server/cache').default;
      if (cache && typeof cache.invalidatePrefix === 'function') {
        cache.invalidatePrefix('tracking:');
      }
    } catch (_cacheErr) {
      // cache is best effort
    }

    return res.json({
      ok: true,
      location: {
        id: created.id != null ? String(created.id) : undefined,
        driver_id: created.driverId,
        latitude: created.latitude,
        longitude: created.longitude,
        recorded_at: created.recordedAt
      }
    });
  } catch (err) {
    console.error('[hotfix] POST /driver/me/location failed:', err);
    return res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// Protected API routes (all require database)
app.use('/admin/drivers', require('../dist-server/server/api/drivers').default);
app.use('/admin/notifications', require('../dist-server/server/api/notifications').default);
app.use('/driver', require('../dist-server/server/api/locations').default);
app.use('/admin/dashboard', require('../dist-server/server/api/adminDashboard').default);
app.use('/admin/reports', require('../dist-server/server/api/reports').default);
app.use('/admin/tracking', require('../dist-server/server/api/tracking').default);
app.use('/messages', require('../dist-server/server/api/messages').default); // Mount at /messages for both admin and driver routes
app.use('/ai', require('../dist-server/server/api/ai').default);
app.use('/deliveries', require('../dist-server/server/api/deliveries').default);
app.use('/sms', require('../dist-server/server/api/sms').default);
app.use('/sap', require('../dist-server/server/api/sap').default);
app.use('/routing', require('../dist-server/server/api/routing').default);

// Global error handler - catch any unhandled errors
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  console.error('Error stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  
  // Don't send error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: 'server_error',
    message: 'Server error. Please try again later.',
    ...(isDevelopment && {
      detail: err.message,
      stack: err.stack
    })
  });
});

// 404 handler
app.use((req, res) => {
  console.log('[404] Path not found:', req.method, req.path);
  console.log('[404] Full URL:', req.url);
  console.log('[404] Base URL:', req.baseUrl);
  res.status(404).json({ error: 'not_found', message: 'Endpoint not found', path: req.path });
});

// Export handler for Vercel Serverless - Database is REQUIRED
// Vercel automatically routes /api/* to this function
module.exports = (req, res) => {
  // OPTIONS preflight: respond immediately so browser never gets 405
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Client-Key, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Log request for debugging
  console.log('[Vercel Handler] Request received:', req.method, req.url);
  console.log('[Vercel Handler] Path:', req.path);
  console.log('[Vercel Handler] Original URL:', req.originalUrl);

  // Handle path normalization - Vercel may or may not strip /api prefix
  // Our Express routes are registered without /api prefix (e.g., /admin/dashboard)
  // So we need to ensure req.url and req.path don't have /api prefix
  if (req.url && req.url.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, '') || '/';
    console.log('[Vercel Handler] Stripped /api, new URL:', req.url);
  }
  if (req.path && req.path.startsWith('/api/')) {
    req.path = req.path.replace(/^\/api/, '') || '/';
    console.log('[Vercel Handler] Stripped /api, new path:', req.path);
  }
  
  // Let Express handle the request
  return app(req, res);
};

// Also export the app for local development/testing
module.exports.app = app;
