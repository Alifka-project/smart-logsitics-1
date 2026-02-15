const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const helmet = require('helmet');
const cors = require('cors');
const prisma = require('./db/prisma');

const app = express();
const port = process.env.PORT || 4000;

const MESSAGE_RETENTION_DAYS = 30;
const MESSAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function cleanupOldMessages() {
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
  } catch (error) {
    console.error('[Cleanup] Failed to delete old messages:', error.message);
  }
}

// Log startup info
console.log('=== SERVER STARTUP ===');
console.log('Node Environment:', process.env.NODE_ENV || 'not set');
console.log('Port:', port);
console.log('Vercel:', process.env.VERCEL ? 'yes' : 'no');
console.log('Database URL:', process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.substring(0, 40) + '...)' : 'NOT SET');
console.log('========================\n');

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: false // CSP may be configured per-deployment
}));

const { authenticate, requireCSRF } = require('./auth');
const { validateEnv } = require('./envCheck');
const { apiLimiter } = require('./security/rateLimiter');

// Rate limiting: use centralized rate limiter
app.use('/api', apiLimiter);

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
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true); // allow non-browser requests (curl, server-to-server)
      if (allowedOriginsFromEnv.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
} else if (process.env.NODE_ENV === 'production') {
  // In production, if no CORS_ORIGINS are provided, default to denying browser origins
  app.use(cors({ origin: false }));
} else {
  // Development convenience: allow any localhost origin (any port) and 127.0.0.1
  app.use(cors({
    origin: function(origin, callback) {
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
} catch (err) {
  console.error('Environment validation failed:', err.message);
  process.exit(1);
}

// Public API routes (no auth)
app.use('/api/auth', require('./api/auth'));
app.use('/api/sms/webhook', require('./api/smsWebhook'));
app.use('/api/customer', require('./api/customerPortal')); // Customer confirmation and tracking (token-based)

// Public SMS confirmation endpoint (before auth middleware)
app.post('/api/sms/confirm', async (req, res) => {
  const smsRouter = require('./api/sms');
  return smsRouter.confirm(req, res);
});

// Health check - verify database connection using Prisma
app.get('/api/health', async (req, res) => {
  try {
    const prisma = require('./db/prisma');
    if (!prisma) {
      return res.status(503).json({ 
        ok: false, 
        database: 'not_initialized', 
        error: 'Prisma client not initialized',
        ts: new Date().toISOString() 
      });
    }
    
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1 as connected`;
    const queryTime = Date.now() - startTime;
    
    res.json({ 
      ok: true, 
      database: 'connected', 
      orm: 'prisma', 
      responseTime: queryTime + 'ms',
      ts: new Date().toISOString() 
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    const statusCode = (error.message && error.message.includes('Can\'t reach database')) ? 503 : 503;
    res.status(statusCode).json({ 
      ok: false, 
      database: 'disconnected', 
      error: error.message || 'Database connection required',
      code: error.code,
      ts: new Date().toISOString() 
    });
  }
});

// Protect all other /api routes with authentication
app.use('/api', authenticate);

// Apply CSRF protection to state-changing operations
app.use('/api', (req, res, next) => {
  // Skip CSRF for auth routes (they handle their own security)
  if (req.path.startsWith('/auth')) {
    return next();
  }
  // Apply CSRF to other routes
  requireCSRF(req, res, next);
});

// Mount protected API routes
app.use('/api/admin/drivers', require('./api/drivers'));
app.use('/api/driver', require('./api/locations'));
app.use('/api/admin/dashboard', require('./api/adminDashboard'));
app.use('/api/admin/notifications', require('./api/notifications'));
app.use('/api/admin/reports', require('./api/reports'));
app.use('/api/admin/tracking', require('./api/tracking'));
app.use('/api/messages', require('./api/messages')); // Mount at /api/messages for both admin and driver routes
app.use('/api/admin/deliveries', require('./api/adminDeliveries'));
app.use('/api/ai', require('./api/ai'));
app.use('/api/deliveries', require('./api/deliveries'));
app.use('/api/sms', require('./api/sms'));
app.use('/api/sap', require('./api/sap'));
app.use('/api/sap-ingestion', require('./api/sap-ingestion')); // SAP data ingestion with POD support

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  cleanupOldMessages();
  setInterval(cleanupOldMessages, MESSAGE_CLEANUP_INTERVAL_MS);
});
