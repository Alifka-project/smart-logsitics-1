import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

const baseURL = (import.meta.env?.VITE_API_BASE as string | undefined) || '/api';
const api: AxiosInstance = axios.create({ baseURL, withCredentials: true });

let refreshPromise: Promise<AxiosResponse<{ accessToken: string }>> | null = null;
let isRefreshing = false;

export function setAuthToken(token: string | null): void {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    try {
      localStorage.setItem('auth_token', token);
    } catch {
      // ignore
    }
  } else {
    delete api.defaults.headers.common['Authorization'];
    try {
      localStorage.removeItem('auth_token');
    } catch {
      // ignore
    }
  }
}

function getCSRFToken(): string | null {
  try {
    return localStorage.getItem('csrf_token');
  } catch {
    return null;
  }
}

// Initialize token from localStorage on module load
try {
  const savedToken = localStorage.getItem('auth_token');
  if (savedToken) {
    api.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
  }
} catch {
  // ignore
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  try {
    const token = localStorage.getItem('auth_token');
    if (token && !config.headers['Authorization']) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    const ck = localStorage.getItem('client_key');
    if (ck) {
      config.headers['x-client-key'] = ck;
    }

    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() ?? '')) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        config.headers['x-csrf-token'] = csrfToken;
      }
    }
  } catch {
    // ignore
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: { config: InternalAxiosRequestConfig & { _retry?: boolean; skipAuthRetry?: boolean }; response?: { status: number } }) => {
    const originalRequest = error.config;

    if (originalRequest?.skipAuthRetry) {
      return Promise.reject(error);
    }

    if (
      error.response?.status === 401 &&
      originalRequest?.url?.includes('/auth/login')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        try {
          await refreshPromise;
          return api(originalRequest);
        } catch (refreshError) {
          handleAuthFailure();
          return Promise.reject(refreshError);
        }
      }

      originalRequest._retry = true;
      isRefreshing = true;
      refreshPromise = refreshAccessToken();

      try {
        const response = await refreshPromise;
        const { accessToken } = response.data;
        setAuthToken(accessToken);
        originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
        isRefreshing = false;
        refreshPromise = null;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshPromise = null;
        handleAuthFailure();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

function refreshAccessToken(): Promise<AxiosResponse<{ accessToken: string }>> {
  return api.post<{ accessToken: string }>('/auth/refresh');
}

function handleAuthFailure(): void {
  try {
    localStorage.removeItem('client_key');
    localStorage.removeItem('client_user');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('csrf_token');
  } catch {
    // ignore
  }

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export default api;
