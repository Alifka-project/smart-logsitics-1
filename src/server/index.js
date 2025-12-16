const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Mount API routes
app.use('/api/admin/drivers', require('./api/drivers'));
app.use('/api/driver', require('./api/locations'));
app.use('/api/sms', require('./api/smsWebhook'));
app.use('/api/auth', require('./api/auth'));
app.use('/api/admin/dashboard', require('./api/adminDashboard'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
