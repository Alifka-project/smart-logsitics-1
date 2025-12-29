import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import api from './frontend/apiClient';
import Header from './components/Layout/Header';
import Navigation from './components/Layout/Navigation';
import HomePage from './pages/HomePage';
import DeliveryListPage from './pages/DeliveryListPage';
import MapViewPage from './pages/MapViewPage';
import LoginPage from './pages/LoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminReportsPage from './pages/AdminReportsPage';
import AdminDriverTrackingPage from './pages/AdminDriverTrackingPage';
import AdminDeliveryTrackingPage from './pages/AdminDeliveryTrackingPage';
import DriverPortal from './pages/DriverPortal';
import AdminUsersPage from './pages/AdminUsersPage';
import TrackingPage from './pages/TrackingPage';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import useDeliveryStore from './store/useDeliveryStore';
import { useTokenRefresh } from './hooks/useTokenRefresh';

function App() {
  // Enable automatic token refresh
  useTokenRefresh();

  useEffect(() => {
    // Initialize deliveries from localStorage on app load
    useDeliveryStore.getState().initializeFromStorage();
  }, []);

  // Auto-logout on inactivity (5 minutes) — keep client-side timer in sync with server inactivity
  useEffect(() => {
    const INACT_MS = import.meta?.env?.VITE_SESSION_INACTIVITY_MS ? parseInt(import.meta.env.VITE_SESSION_INACTIVITY_MS, 10) : 5 * 60 * 1000;
    let lastActivity = Date.now();
    let timeout = null;
    function reset() {
      lastActivity = Date.now();
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(checkIdle, INACT_MS + 1000);
    }
    function checkIdle() {
      if (Date.now() - lastActivity >= INACT_MS) {
        // perform logout call and redirect
        try {
          api.post('/auth/logout').catch(()=>{}).finally(() => {
            try { localStorage.removeItem('client_key'); } catch (e) {}
            window.location.href = '/login';
          });
        } catch (e) {
          try { localStorage.removeItem('client_key'); } catch (e) {}
          window.location.href = '/login';
        }
      } else {
        reset();
      }
    }
    ['click','mousemove','keydown','scroll','touchstart'].forEach(ev => window.addEventListener(ev, reset));
    reset();
    return () => {
      ['click','mousemove','keydown','scroll','touchstart'].forEach(ev => window.removeEventListener(ev, reset));
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes - NO header, NO navigation */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/track/:deliveryId" element={<TrackingPage />} />

        {/* Protected routes - with header and navigation */}
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </BrowserRouter>
  );
}

// Protected Layout Component - wraps authenticated pages with header and navigation
function ProtectedLayout() {
  const clientUser = (() => { try { return JSON.parse(localStorage.getItem('client_user') || 'null'); } catch(e) { return null; } })();
  const showNavigation = !!(clientUser && clientUser.role === 'admin');

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50">
        <Header />
        {showNavigation && <Navigation />}
        <main className="container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/deliveries" element={<DeliveryListPage />} />
            <Route path="/map" element={<MapViewPage />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/reports" element={<AdminReportsPage />} />
            <Route path="/admin/tracking/drivers" element={<AdminDriverTrackingPage />} />
            <Route path="/admin/tracking/deliveries" element={<AdminDeliveryTrackingPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/driver" element={<DriverPortal />} />
          </Routes>
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default App;
