const { URL } = require('url');

function requireEnv(varName) {
  if (!process.env[varName]) {
    throw new Error(`Required environment variable ${varName} is missing`);
  }
}

function validateEnv() {
  // Minimal required envs for secure operation.
  // Require `JWT_SECRET` in production, but allow a development default otherwise.
  const required = [];
  if (process.env.NODE_ENV === 'production') {
    required.push('JWT_SECRET');
  } else {
    if (!process.env.JWT_SECRET) {
      // In development we permit a missing JWT_SECRET but warn the developer.
      // The server code provides a safe development default.
      // This prevents the server from exiting during local development when env vars are not set.
      // eslint-disable-next-line no-console
      console.warn('Warning: JWT_SECRET not set; using development default. Set JWT_SECRET in production.');
    }
  }
  for (const v of required) requireEnv(v);

  // SAP_BASE_URL is optional but if present validate format
  if (process.env.SAP_BASE_URL) {
    try {
      new URL(process.env.SAP_BASE_URL);
    } catch (e) {
      throw new Error('SAP_BASE_URL is not a valid URL');
    }
  }
}

module.exports = { validateEnv };
