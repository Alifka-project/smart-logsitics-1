/**
 * Vercel Serverless Function Entry Point
 * Database is REQUIRED - This exports the Express app for Vercel serverless deployment
 * All endpoints require PostgreSQL database connection
 */

const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4000;

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: false
}));

const { authenticate, requireCSRF } = require('../src/server/auth');
const { validateEnv } = require('../src/server/envCheck');
const { apiLimiter } = require('../src/server/security/rateLimiter');

// Rate limiting
app.use('/api', apiLimiter);

// HTTPS redirect (if needed)
app.use((req, res, next) => {
  const enforceHttps = process.env.ENFORCE_HTTPS === '1';
  if (enforceHttps && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// CORS - Database integration required, so allow Vercel domains
const rawOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOriginsFromEnv = rawOrigins.length ? rawOrigins : [];

if (allowedOriginsFromEnv.length) {
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOriginsFromEnv.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
} else {
  // Production: allow Vercel domains and configured origins
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      const vercelDomain = /\.vercel\.app$/.test(origin);
      const isAllowed = allowedOriginsFromEnv.length === 0 || allowedOriginsFromEnv.indexOf(origin) !== -1;
      if (vercelDomain || isAllowed) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
}

app.disable('x-powered-by');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Validate environment - DATABASE IS REQUIRED
try {
  validateEnv();
  // Verify database connection is configured
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is REQUIRED');
    throw new Error('DATABASE_URL is required. Database integration is mandatory.');
  }
} catch (e) {
  console.error('Environment validation failed:', e.message);
  // Don't exit in serverless - let it fail on first request
}

// Public API routes (all require database)
app.use('/api/auth', require('../src/server/api/auth'));
app.use('/api/sms/webhook', require('../src/server/api/smsWebhook'));

// Migration endpoint (ONE TIME USE - remove after migration)
app.use('/api/migrate', require('../src/server/api/migrate'));

app.post('/api/sms/confirm', async (req, res) => {
  const smsRouter = require('../src/server/api/sms');
  return smsRouter.confirm(req, res);
});

app.get('/api/health', async (req, res) => {
  // Health check - verify database connection using Prisma
  try {
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      return res.status(503).json({ 
        ok: false, 
        database: 'disconnected', 
        error: 'DATABASE_URL environment variable is not set',
        ts: new Date().toISOString() 
      });
    }

    // Try to load Prisma client
    let prisma;
    try {
      prisma = require('../src/server/db/prisma');
    } catch (prismaError) {
      return res.status(503).json({ 
        ok: false, 
        database: 'disconnected', 
        error: `Prisma client error: ${prismaError.message}`,
        ts: new Date().toISOString() 
      });
    }

    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected', orm: 'prisma', ts: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ 
      ok: false, 
      database: 'disconnected', 
      error: error.message || 'Database connection failed',
      ts: new Date().toISOString() 
    });
  }
});

// Protect all other /api routes
app.use('/api', authenticate);

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) {
    return next();
  }
  requireCSRF(req, res, next);
});

// Protected API routes (all require database)
app.use('/api/admin/drivers', require('../src/server/api/drivers'));
app.use('/api/driver', require('../src/server/api/locations'));
app.use('/api/admin/dashboard', require('../src/server/api/adminDashboard'));
app.use('/api/admin/reports', require('../src/server/api/reports'));
app.use('/api/admin/tracking', require('../src/server/api/tracking'));
app.use('/api/ai', require('../src/server/api/ai'));
app.use('/api/deliveries', require('../src/server/api/deliveries'));
app.use('/api/sms', require('../src/server/api/sms'));
app.use('/api/sap', require('../src/server/api/sap'));

// Export for Vercel - Database is REQUIRED
module.exports = app;
