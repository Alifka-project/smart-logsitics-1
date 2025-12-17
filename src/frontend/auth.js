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
  const t = getToken();
  const p = parseToken(t);
  if (!p) return null;
  return { id: p.sub, role: p.role, username: p.username, exp: p.exp };
}

export function isAuthenticated() {
  const u = getCurrentUser();
  if (!u) return false;
  if (u.exp && typeof u.exp === 'number') {
    return u.exp * 1000 > Date.now();
  }
  return true;
}
