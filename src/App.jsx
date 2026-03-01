import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from './frontend/apiClient';
import Header from './components/Layout/Header';
import Sidebar from './components/Layout/Sidebar';
import DeliveryManagementPage from './pages/DeliveryManagementPage';
import HomePage from './pages/HomePage';
import DeliveryListPage from './pages/DeliveryListPage';
import MapViewPage from './pages/MapViewPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminOperationsPage from './pages/AdminOperationsPage';
import AdminReportsPage from './pages/AdminReportsPage';
import AdminPODReportPage from './pages/AdminPODReportPage';
import AdminDriverTrackingPage from './pages/AdminDriverTrackingPage';
import AdminDeliveryTrackingPage from './pages/AdminDeliveryTrackingPage';
import DriverPortal from './pages/DriverPortal';
import DeliveryTeamPortal from './pages/DeliveryTeamPortal';
import AdminUsersPage from './pages/AdminUsersPage';
import TrackingPage from './pages/TrackingPage';
import CustomerConfirmationPage from './pages/CustomerConfirmationPage';
import CustomerTrackingPage from './pages/CustomerTrackingPage';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import useDeliveryStore from './store/useDeliveryStore';
import { useTokenRefresh } from './hooks/useTokenRefresh';

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
    </BrowserRouter>
  );
}

function ProtectedLayout() {
  const clientUser = (() => {
    try { return JSON.parse(localStorage.getItem('client_user') || 'null'); } catch { return null; }
  })();
  const isAdmin = clientUser?.role === 'admin';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const handleSidebarToggle = () => {
    setSidebarCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  };

  const pageRoutes = (
    <Routes>
      <Route path="/deliveries" element={<DeliveryManagementPage />} />
      <Route path="/" element={<Navigate to="/deliveries" replace />} />
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
  );

  return (
    <ProtectedRoute>
      {isAdmin ? (
        /* ── Admin: sidebar + slim top-bar ── */
        <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={handleSidebarToggle}
            mobileOpen={mobileSidebarOpen}
            onMobileClose={() => setMobileSidebarOpen(false)}
          />
          <div
            className={`flex flex-col flex-1 min-w-0 transition-all duration-300 ${
              sidebarCollapsed ? 'md:ml-[68px]' : 'md:ml-[240px]'
            }`}
          >
            <Header
              isAdmin
              onMenuOpen={() => setMobileSidebarOpen(true)}
            />
            <main className="flex-1 px-4 sm:px-6 py-6 overflow-auto">
              {pageRoutes}
            </main>
          </div>
        </div>
      ) : (
        /* ── Non-admin: full-width header ── */
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <Header isAdmin={false} />
          <main className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl">
            {pageRoutes}
          </main>
        </div>
      )}
    </ProtectedRoute>
  );
}

export default App;
