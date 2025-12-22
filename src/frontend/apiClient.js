import axios from 'axios';

const baseURL = (import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
const api = axios.create({ baseURL, withCredentials: true });

export function setAuthToken(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

// Attach client-key header from localStorage for session binding
api.interceptors.request.use((cfg) => {
  try {
    const ck = localStorage.getItem('client_key');
    if (ck) cfg.headers['x-client-key'] = ck;
  } catch (e) {
    // ignore
  }
  return cfg;
});

export default api;
