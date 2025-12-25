const { callSap } = require('./sapConnector');

async function ping() {
  // A light-weight ping can call a configurable health endpoint or the base URL
  const res = await callSap('', 'get');
  return res;
}

async function call(endpoint, method = 'get', data = null, params = {}) {
  return callSap(endpoint, method, data, params);
}

module.exports = { ping, call };
