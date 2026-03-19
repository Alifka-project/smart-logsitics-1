import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, Suspense, lazy } from 'react';
import api from './frontend/apiClient';
import Header from './components/Layout/Header';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import useDeliveryStore from './store/useDeliveryStore';
import { useTokenRefresh } from './hooks/useTokenRefresh';

import LoginPage from './pages/LoginPage';

const DeliveryManagementPage  = lazy(() => import('./pages/DeliveryManagementPage'));
const AdminDashboardPage       = lazy(() => import('./pages/AdminDashboardPage'));
const AdminOperationsPage      = lazy(() => import('./pages/AdminOperationsPage'));
const AdminReportsPage         = lazy(() => import('./pages/AdminReportsPage'));
const AdminPODReportPage       = lazy(() => import('./pages/AdminPODReportPage'));
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

  useEffect(() => {
    const INACT_MS = import.meta?.env?.VITE_SESSION_INACTIVITY_MS
      ? parseInt(import.meta.env.VITE_SESSION_INACTIVITY_MS as string, 10)
      : 15 * 60 * 1000;
    let lastActivity = Date.now();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function reset(): void {
      lastActivity = Date.now();
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(checkIdle, INACT_MS + 1000);
    }

    function checkIdle(): void {
      if (Date.now() - lastActivity >= INACT_MS) {
        try {
          api
            .post('/auth/logout')
            .catch(() => {})
            .finally(() => {
              try {
                localStorage.removeItem('client_key');
              } catch {
                // ignore
              }
              window.location.href = '/login';
            });
        } catch {
          try {
            localStorage.removeItem('client_key');
          } catch {
            // ignore
          }
          window.location.href = '/login';
        }
      } else {
        reset();
      }
    }

    const events = ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, reset));
    reset();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset));
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <img
                src="/elect home.png"
                alt="Electrolux"
                style={{ height: '36px', objectFit: 'contain', opacity: 0.9 }}
              />
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  border: '2.5px solid var(--primary)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            </div>
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/track/:deliveryId" element={<TrackingPage />} />
          <Route path="/confirm-delivery/:token" element={<CustomerConfirmationPage />} />
          <Route path="/tracking/:token" element={<CustomerTrackingPage />} />
          <Route path="/customer-tracking/:token" element={<CustomerTrackingPage />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function AnimatedRoutes({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation();
  return (
    <main className="app-main">
      <div key={location.key} className="page-enter">
        <Routes>
          <Route path="/deliveries" element={<DeliveryManagementPage />} />
          <Route
            path="/"
            element={<Navigate to={isAdmin ? '/admin' : '/deliveries'} replace />}
          />
          <Route path="/map" element={<Navigate to="/deliveries?tab=map" replace />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/operations" element={<AdminOperationsPage />} />
          <Route path="/admin/reports" element={<AdminReportsPage />} />
          <Route path="/admin/reports/pod" element={<AdminPODReportPage />} />
          <Route
            path="/admin/tracking/drivers"
            element={<Navigate to="/admin/operations?tab=monitoring" replace />}
          />
          <Route
            path="/admin/tracking/deliveries"
            element={<Navigate to="/admin/operations?tab=delivery-tracking" replace />}
          />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/driver" element={<DriverPortal />} />
          <Route path="/delivery-team" element={<DeliveryTeamPortal />} />
        </Routes>
      </div>
    </main>
  );
}

function ProtectedLayout() {
  const clientUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('client_user') || 'null') as { role?: string } | null;
    } catch {
      return null;
    }
  })();
  const isAdmin = clientUser?.role === 'admin';

  return (
    <ProtectedRoute>
      <div
        style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', paddingTop: '14px' }}
      >
        <Header isAdmin={isAdmin} />
        <AnimatedRoutes isAdmin={isAdmin} />
      </div>
    </ProtectedRoute>
  );
}

export default App;
