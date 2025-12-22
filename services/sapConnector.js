const axios = require('axios');
const { URL } = require('url');

const SAP_BASE_URL = process.env.SAP_BASE_URL || '';
const SAP_USERNAME = process.env.SAP_USERNAME;
const SAP_PASSWORD = process.env.SAP_PASSWORD;

function validateBaseUrl() {
  if (!SAP_BASE_URL) throw new Error('SAP_BASE_URL not configured');
  // disallow plain http in production unless explicitly allowed for localhost
  try {
    const u = new URL(SAP_BASE_URL);
    if (u.protocol !== 'https:' && !u.hostname.includes('localhost') && process.env.NODE_ENV === 'production') {
      throw new Error('SAP_BASE_URL must use https in production');
    }
    return u.toString().replace(/\/$/, '');
  } catch (e) {
    throw new Error('SAP_BASE_URL is invalid: ' + e.message);
  }
}

async function callSap(endpoint, method = 'get', data = null, params = {}) {
  const base = validateBaseUrl();

  const url = `${base}/${endpoint.replace(/^\//, '')}`;

  const config = {
    method,
    url,
    params,
    data,
    timeout: 20000,
    // Do not follow redirects automatically for security reasons
    maxRedirects: 0,
    validateStatus: status => status < 500 // treat 4xx as normal responses
  };

  if (SAP_USERNAME && SAP_PASSWORD) {
    // Use axios basic auth; do NOT log credentials anywhere
    config.auth = { username: SAP_USERNAME, password: SAP_PASSWORD };
  }

  const resp = await axios(config);
  return resp;
}

module.exports = { callSap };
