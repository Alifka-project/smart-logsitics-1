/**
 * Frontend authentication utilities
 * Handles token storage, validation, and user state
 */
import type { AuthUser, AuthData } from '../types';

export function getToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

export function parseToken(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json: AuthUser = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return json;
  } catch {
    return null;
  }
}

export function getCurrentUser(): AuthUser | null {
  try {
    const u = localStorage.getItem('client_user');
    if (!u) return null;
    return JSON.parse(u) as AuthUser;
  } catch {
    return null;
  }
}

export function getCSRFToken(): string | null {
  try {
    return localStorage.getItem('csrf_token');
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const ck = (() => {
    try {
      return localStorage.getItem('client_key');
    } catch {
      return null;
    }
  })();
  const u = getCurrentUser();
  const token = getToken();

  if (token) {
    const decoded = parseToken(token);
    if (decoded?.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp < now) {
        return !!(ck && u);
      }
    }
  }

  return !!(ck && u);
}

export function isTokenExpired(): boolean {
  const token = getToken();
  if (!token) return true;

  const decoded = parseToken(token);
  if (!decoded?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return decoded.exp < now;
}

export function getTokenExpirationTime(): number | null {
  const token = getToken();
  if (!token) return null;

  const decoded = parseToken(token);
  if (!decoded?.exp) return null;

  return decoded.exp * 1000;
}

export function clearAuth(): void {
  try {
    localStorage.removeItem('client_key');
    localStorage.removeItem('client_user');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('csrf_token');
  } catch {
    // ignore
  }
}

export function setAuthData(data: AuthData): void {
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
