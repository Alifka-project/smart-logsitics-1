import React, { useState } from 'react';
import useDeliveryStore from '../store/useDeliveryStore';
import FileUpload from '../components/Upload/FileUpload';
import SyntheticDataButton from '../components/Upload/SyntheticDataButton';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import StatsCards from '../components/Analytics/StatsCards';

export default function DeliveryListPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Upload Section */}
      {deliveries.length === 0 && (
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 lg:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6">
            Upload Delivery Documents
          </h2>
          <FileUpload />
          <div className="mt-4 text-center">
            <div className="text-gray-500 mb-4">or</div>
            <SyntheticDataButton />
          </div>
        </div>
      )}

      {/* Analytics */}
      {deliveries.length > 0 && <StatsCards />}

      {/* Delivery List */}
      {deliveries.length > 0 && (
        <DeliveryTable onSelectDelivery={() => setShowModal(true)} />
      )}

      {/* Customer Details Modal */}
      <CustomerModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
      />
    </div>
  );
}

