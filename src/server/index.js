const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const { authenticate } = require('./auth');

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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
