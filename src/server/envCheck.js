const { URL } = require('url');

function requireEnv(varName) {
  if (!process.env[varName]) {
    throw new Error(`Required environment variable ${varName} is missing`);
  }
}

function validateEnv() {
  // Minimal required envs for secure operation
  const required = ['JWT_SECRET'];
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
