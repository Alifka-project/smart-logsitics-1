import axios from 'axios';

const baseURL = (import.meta.env && import.meta.env.VITE_API_BASE) || '/api';
const api = axios.create({ baseURL, withCredentials: true });

// Token refresh state
let refreshPromise = null;
let isRefreshing = false;

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    try {
      localStorage.setItem('auth_token', token);
    } catch (e) {
      // Ignore localStorage errors
    }
  } else {
    delete api.defaults.headers.common.Authorization;
    try {
      localStorage.removeItem('auth_token');
    } catch (e) {
      // Ignore localStorage errors
    }
  }
}

// Get CSRF token from localStorage
function getCSRFToken() {
  try {
    return localStorage.getItem('csrf_token');
  } catch (e) {
    return null;
  }
}

// Initialize token from localStorage on module load
try {
  const savedToken = localStorage.getItem('auth_token');
  if (savedToken) {
    api.defaults.headers.common.Authorization = `Bearer ${savedToken}`;
  }
} catch (e) {
  // Ignore localStorage errors
}

// Attach client-key, auth token, and CSRF token headers
api.interceptors.request.use((config) => {
  try {
    // Ensure auth token is set from localStorage (in case it was updated elsewhere)
    const token = localStorage.getItem('auth_token');
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    const ck = localStorage.getItem('client_key');
    if (ck) {
      config.headers['x-client-key'] = ck;
    }
    
    // Add CSRF token for state-changing operations
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase())) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        config.headers['x-csrf-token'] = csrfToken;
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return config;
});

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Skip refresh for session check — avoid infinite loop on protected route
    if (originalRequest?.skipAuthRetry) {
      return Promise.reject(error);
    }

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      // If we're already refreshing, wait for it
      if (isRefreshing) {
        try {
          await refreshPromise;
          // Retry original request with new token
          return api(originalRequest);
        } catch (refreshError) {
          // Refresh failed, redirect to login
          handleAuthFailure();
          return Promise.reject(refreshError);
        }
      }

      // Start refresh process
      originalRequest._retry = true;
      isRefreshing = true;
      refreshPromise = refreshAccessToken();

      try {
        const response = await refreshPromise;
        const { accessToken } = response.data;
        setAuthToken(accessToken);
        
        // Update original request with new token
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        
        isRefreshing = false;
        refreshPromise = null;
        
        // Retry original request
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshPromise = null;
        handleAuthFailure();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// Refresh access token using refresh token cookie
async function refreshAccessToken() {
  return api.post('/auth/refresh');
}

// Handle authentication failure
function handleAuthFailure() {
  try {
    localStorage.removeItem('client_key');
    localStorage.removeItem('client_user');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('csrf_token');
  } catch (e) {
    // Ignore errors
  }
  
  // Redirect to login if not already there
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export default api;
