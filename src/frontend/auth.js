export function getToken() {
  try { return localStorage.getItem('auth_token'); } catch (e) { return null; }
}

export function parseToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json;
  } catch (e) { return null; }
}

export function getCurrentUser() {
  try {
    const u = localStorage.getItem('client_user');
    if (!u) return null;
    return JSON.parse(u);
  } catch (e) {
    return null;
  }
}

export function isAuthenticated() {
  const ck = (() => { try { return localStorage.getItem('client_key'); } catch (e) { return null; } })();
  const u = getCurrentUser();
  return !!(ck && u);
}
