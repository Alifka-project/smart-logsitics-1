const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4000;

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
      } catch (e) {
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
} catch (e) {
  console.error('Environment validation failed:', e.message);
  process.exit(1);
}

// Public API routes (no auth)
app.use('/api/auth', require('./api/auth'));
app.use('/api/sms/webhook', require('./api/smsWebhook'));

// Public SMS confirmation endpoint (before auth middleware)
app.post('/api/sms/confirm', async (req, res) => {
  const smsRouter = require('./api/sms');
  return smsRouter.confirm(req, res);
});

// Health check - verify database connection using Prisma
app.get('/api/health', async (req, res) => {
  try {
    const prisma = require('./db/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected', orm: 'prisma', ts: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ 
      ok: false, 
      database: 'disconnected', 
      error: 'Database connection required',
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
app.use('/api/admin/reports', require('./api/reports'));
app.use('/api/admin/tracking', require('./api/tracking'));
app.use('/api/admin/messages', require('./api/messages'));
app.use('/api/admin/deliveries', require('./api/adminDeliveries'));
app.use('/api/ai', require('./api/ai'));
app.use('/api/deliveries', require('./api/deliveries'));
app.use('/api/sms', require('./api/sms'));
app.use('/api/sap', require('./api/sap'));

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
