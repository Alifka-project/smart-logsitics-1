/**
 * Vercel Serverless Function Entry Point
 * Database is REQUIRED - This exports the Express app for Vercel serverless deployment
 * All endpoints require PostgreSQL database connection
 * Build: 2026-02-02
 */

const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4000;

// CORS - Allow all origins for Vercel deployment
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Handle preflight requests
app.options('*', cors());

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: false
}));

const { authenticate, requireCSRF } = require('../src/server/auth');
const { validateEnv } = require('../src/server/envCheck');
const { apiLimiter } = require('../src/server/security/rateLimiter');

// Rate limiting
app.use(apiLimiter);

app.disable('x-powered-by');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Environment check:', {
    DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL ? 'yes' : 'no'
  });
  next();
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

// Public API routes (all require database)
app.use('/auth', require('../src/server/api/auth'));
app.use('/sms/webhook', require('../src/server/api/smsWebhook'));
app.use('/customer', require('../src/server/api/customerPortal'));

// Migration endpoint (ONE TIME USE - remove after migration)
app.use('/migrate', require('../src/server/api/migrate'));

app.post('/sms/confirm', async (req, res) => {
  const smsRouter = require('../src/server/api/sms');
  return smsRouter.confirm(req, res);
});

app.get('/health', async (req, res) => {
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

// Diagnostic endpoint - check data and database status
app.get('/diag/status', async (req, res) => {
  try {
    const prisma = require('../src/server/db/prisma');
    
    // Count deliveries
    const deliveryCount = await prisma.delivery.count();
    const smsLogCount = await prisma.smsLog.count();
    const driverCount = await prisma.driver.count();
    const assignmentCount = await prisma.deliveryAssignment.count();
    
    // Get sample delivery if exists
    const sampleDelivery = await prisma.delivery.findFirst();
    
    res.json({
      ok: true,
      database: 'connected',
      data: {
        deliveries: deliveryCount,
        smsLogs: smsLogCount,
        drivers: driverCount,
        assignments: assignmentCount,
        sampleDelivery: sampleDelivery ? {
          id: sampleDelivery.id,
          customer: sampleDelivery.customer,
          status: sampleDelivery.status,
          createdAt: sampleDelivery.createdAt
        } : null
      },
      ts: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
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

// Protected API routes (all require database)
app.use('/admin/drivers', require('../src/server/api/drivers'));
app.use('/driver', require('../src/server/api/locations'));
app.use('/admin/dashboard', require('../src/server/api/adminDashboard'));
app.use('/admin/reports', require('../src/server/api/reports'));
app.use('/admin/tracking', require('../src/server/api/tracking'));
app.use('/admin/messages', require('../src/server/api/messages'));
app.use('/driver/messages', require('../src/server/api/messages'));
app.use('/ai', require('../src/server/api/ai'));
app.use('/deliveries', require('../src/server/api/deliveries'));
app.use('/sms', require('../src/server/api/sms'));
app.use('/sap', require('../src/server/api/sap'));

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
// Vercel requires a function export, not the Express app directly
module.exports = (req, res) => {
  // Let Express handle the request
  return app(req, res);
};

// Also export the app for local development/testing
module.exports.app = app;
