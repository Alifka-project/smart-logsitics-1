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

// Rate limiting: reasonable default, tune for your environment
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // limit each IP to 120 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
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
const defaultAllowed = process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = rawOrigins.length ? rawOrigins : defaultAllowed;
if (allowedOrigins.length) {
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true); // allow non-browser requests (curl, server-to-server)
      if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    optionsSuccessStatus: 200,
  }));
}

// Hide implementation details
app.disable('x-powered-by');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const { authenticate } = require('./auth');
const { validateEnv } = require('./envCheck');

// Validate critical environment variables at startup
try {
  validateEnv();
} catch (e) {
  console.error('Environment validation failed:', e.message);
  process.exit(1);
}

// Public API routes (no auth)
app.use('/api/auth', require('./api/auth'));
app.use('/api/sms', require('./api/smsWebhook'));
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Protect all other /api routes with authentication
app.use('/api', authenticate);

// Mount protected API routes
app.use('/api/admin/drivers', require('./api/drivers'));
app.use('/api/driver', require('./api/locations'));
app.use('/api/admin/dashboard', require('./api/adminDashboard'));
app.use('/api/ai', require('./api/ai'));
app.use('/api/deliveries', require('./api/deliveries'));
app.use('/api/sap', require('./api/sap'));

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
