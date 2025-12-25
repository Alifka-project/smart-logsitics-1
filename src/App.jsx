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
import DriverPortal from './pages/DriverPortal';
import AdminUsersPage from './pages/AdminUsersPage';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import useDeliveryStore from './store/useDeliveryStore';

function App() {
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

  const clientUser = (() => { try { return JSON.parse(localStorage.getItem('client_user') || 'null'); } catch(e) { return null; } })();
  const showNavigation = !!(clientUser && clientUser.role === 'admin');

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Header />
        {showNavigation && <Navigation />}
        <main className="container mx-auto px-4 py-6">
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes - require authentication */}
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/deliveries" element={<ProtectedRoute><DeliveryListPage /></ProtectedRoute>} />
            <Route path="/map" element={<ProtectedRoute><MapViewPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute><AdminUsersPage /></ProtectedRoute>} />
            <Route path="/driver" element={<ProtectedRoute><DriverPortal /></ProtectedRoute>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
