const { callSap } = require('./sapConnector');

async function ping() {
  // A light-weight ping can call a configurable health endpoint or the base URL
  try {
    const res = await callSap('', 'get');
    return res;
  } catch (err) {
    // Normalize error
    throw err;
  }
}

async function call(endpoint, method = 'get', data = null, params = {}) {
  return callSap(endpoint, method, data, params);
}

module.exports = { ping, call };
