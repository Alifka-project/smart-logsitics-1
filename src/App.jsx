import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import api from './frontend/apiClient';
import Header from './components/Layout/Header';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import useDeliveryStore from './store/useDeliveryStore';
import { useTokenRefresh } from './hooks/useTokenRefresh';

// Eagerly load auth pages (needed immediately on first load)
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

// Lazy-load all other pages for better bundle splitting
const DeliveryManagementPage  = lazy(() => import('./pages/DeliveryManagementPage'));
const AdminDashboardPage       = lazy(() => import('./pages/AdminDashboardPage'));
const AdminOperationsPage      = lazy(() => import('./pages/AdminOperationsPage'));
const AdminReportsPage         = lazy(() => import('./pages/AdminReportsPage'));
const AdminPODReportPage       = lazy(() => import('./pages/AdminPODReportPage'));
const AdminDriverTrackingPage  = lazy(() => import('./pages/AdminDriverTrackingPage'));
const AdminDeliveryTrackingPage= lazy(() => import('./pages/AdminDeliveryTrackingPage'));
const AdminUsersPage           = lazy(() => import('./pages/AdminUsersPage'));
const DriverPortal             = lazy(() => import('./pages/DriverPortal'));
const DeliveryTeamPortal       = lazy(() => import('./pages/DeliveryTeamPortal'));
const TrackingPage             = lazy(() => import('./pages/TrackingPage'));
const CustomerConfirmationPage = lazy(() => import('./pages/CustomerConfirmationPage'));
const CustomerTrackingPage     = lazy(() => import('./pages/CustomerTrackingPage'));

function App() {
  useTokenRefresh();

  useEffect(() => {
    useDeliveryStore.getState().initializeFromStorage();
  }, []);

  // Auto-logout on inactivity
  useEffect(() => {
    const INACT_MS = import.meta?.env?.VITE_SESSION_INACTIVITY_MS
      ? parseInt(import.meta.env.VITE_SESSION_INACTIVITY_MS, 10)
      : 15 * 60 * 1000;
    let lastActivity = Date.now();
    let timeout = null;
    function reset() {
      lastActivity = Date.now();
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(checkIdle, INACT_MS + 1000);
    }
    function checkIdle() {
      if (Date.now() - lastActivity >= INACT_MS) {
        try {
          api.post('/auth/logout').catch(() => {}).finally(() => {
            try { localStorage.removeItem('client_key'); } catch {}
            window.location.href = '/login';
          });
        } catch {
          try { localStorage.removeItem('client_key'); } catch {}
          window.location.href = '/login';
        }
      } else {
        reset();
      }
    }
    ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(ev => window.addEventListener(ev, reset));
    reset();
    return () => {
      ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(ev => window.removeEventListener(ev, reset));
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm"
              style={{ background: 'var(--accent)' }}
            >E</div>
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          </div>
        </div>
      }>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/track/:deliveryId" element={<TrackingPage />} />
          <Route path="/confirm-delivery/:token" element={<CustomerConfirmationPage />} />
          <Route path="/tracking/:token" element={<CustomerTrackingPage />} />
          <Route path="/customer-tracking/:token" element={<CustomerTrackingPage />} />

          {/* Protected routes */}
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function ProtectedLayout() {
  const clientUser = (() => {
    try { return JSON.parse(localStorage.getItem('client_user') || 'null'); } catch { return null; }
  })();
  const isAdmin = clientUser?.role === 'admin';

  return (
    <ProtectedRoute>
      <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
        <Header isAdmin={isAdmin} />
        <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '28px 24px' }}>
          <Routes>
            <Route path="/deliveries" element={<DeliveryManagementPage />} />
            <Route path="/" element={<Navigate to={isAdmin ? '/admin' : '/deliveries'} replace />} />
            <Route path="/map" element={<Navigate to="/deliveries?tab=map" replace />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/operations" element={<AdminOperationsPage />} />
            <Route path="/admin/reports" element={<AdminReportsPage />} />
            <Route path="/admin/reports/pod" element={<AdminPODReportPage />} />
            <Route path="/admin/tracking/drivers" element={<AdminDriverTrackingPage />} />
            <Route path="/admin/tracking/deliveries" element={<AdminDeliveryTrackingPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/driver" element={<DriverPortal />} />
            <Route path="/delivery-team" element={<DeliveryTeamPortal />} />
          </Routes>
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default App;
