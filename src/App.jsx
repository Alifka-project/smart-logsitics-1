import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Layout/Header';
import Navigation from './components/Layout/Navigation';
import DeliveryListPage from './pages/DeliveryListPage';
import MapViewPage from './pages/MapViewPage';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <Navigation />
        <main className="container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/deliveries" replace />} />
            <Route path="/deliveries" element={<DeliveryListPage />} />
            <Route path="/map" element={<MapViewPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
