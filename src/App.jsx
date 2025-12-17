import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Layout/Header';
import Navigation from './components/Layout/Navigation';
import HomePage from './pages/HomePage';
import DeliveryListPage from './pages/DeliveryListPage';
import MapViewPage from './pages/MapViewPage';
import LoginPage from './pages/LoginPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import DriverPortal from './pages/DriverPortal';
import AdminUsersPage from './pages/AdminUsersPage';
import useDeliveryStore from './store/useDeliveryStore';

function App() {
  useEffect(() => {
    // Initialize deliveries from localStorage on app load
    useDeliveryStore.getState().initializeFromStorage();
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <Navigation />
        <main className="container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/deliveries" element={<DeliveryListPage />} />
            <Route path="/map" element={<MapViewPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/driver" element={<DriverPortal />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
