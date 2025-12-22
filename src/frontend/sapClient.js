import api from './apiClient';

export async function pingSap() {
  return api.get('/sap/ping');
}

export async function callSap(endpoint, method = 'post', body = {}) {
  return api.post('/sap/call', { endpoint, method, ...body });
}

export default { pingSap, callSap };
