/**
 * Frontend authentication utilities
 * Handles token storage, validation, and user state
 */

export function getToken() {
  try {
    return localStorage.getItem('auth_token');
  } catch (e) {
    return null;
  }
}

export function parseToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json;
  } catch (e) {
    return null;
  }
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

export function getCSRFToken() {
  try {
    return localStorage.getItem('csrf_token');
  } catch (e) {
    return null;
  }
}

export function isAuthenticated() {
  const ck = (() => {
    try {
      return localStorage.getItem('client_key');
    } catch (e) {
      return null;
    }
  })();
  const u = getCurrentUser();
  const token = getToken();
  
  // Check if token is expired
  if (token) {
    const decoded = parseToken(token);
    if (decoded && decoded.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp < now) {
        // Token expired, but might be refreshed
        return !!(ck && u);
      }
    }
  }
  
  return !!(ck && u);
}

export function isTokenExpired() {
  const token = getToken();
  if (!token) return true;
  
  const decoded = parseToken(token);
  if (!decoded || !decoded.exp) return true;
  
  const now = Math.floor(Date.now() / 1000);
  return decoded.exp < now;
}

export function getTokenExpirationTime() {
  const token = getToken();
  if (!token) return null;
  
  const decoded = parseToken(token);
  if (!decoded || !decoded.exp) return null;
  
  return decoded.exp * 1000; // Convert to milliseconds
}

export function clearAuth() {
  try {
    localStorage.removeItem('client_key');
    localStorage.removeItem('client_user');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('csrf_token');
  } catch (e) {
    // Ignore errors
  }
}

export function setAuthData(data) {
  try {
    if (data.clientKey) {
      localStorage.setItem('client_key', data.clientKey);
    }
    if (data.driver) {
      localStorage.setItem('client_user', JSON.stringify(data.driver));
    }
    if (data.accessToken) {
      localStorage.setItem('auth_token', data.accessToken);
    }
    if (data.csrfToken) {
      localStorage.setItem('csrf_token', data.csrfToken);
    }
  } catch (e) {
    console.error('Failed to set auth data:', e);
  }
}
