import React, { useState } from 'react';
import useDeliveryStore from '../store/useDeliveryStore';
import FileUpload from '../components/Upload/FileUpload';
import SyntheticDataButton from '../components/Upload/SyntheticDataButton';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import StatsCards from '../components/Analytics/StatsCards';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';

export default function DeliveryListPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [showModal, setShowModal] = useState(false);
  const { toasts, removeToast, success, error, warning } = useToast();

  const handleFileSuccess = (result) => {
    success(`✓ Successfully loaded ${result.count} deliveries`);
    if (result.warnings && result.warnings.length > 0) {
      warning(`⚠ ${result.warnings.length} warning(s) found during validation`);
    }
  };

  const handleFileError = (result) => {
    if (result.errors && result.errors.length > 0) {
      error(`Validation failed:\n${result.errors.join('\n')}`);
    } else {
      error('Failed to process file');
    }
  };

  const handleSyntheticSuccess = (result) => {
    success(`✓ Successfully loaded ${result.count} test deliveries`);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Upload Section */}
      {deliveries.length === 0 && (
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 lg:p-8">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6">
            Upload Delivery Documents
          </h2>
          <FileUpload onSuccess={handleFileSuccess} onError={handleFileError} />
          <div className="mt-4 text-center">
            <div className="text-gray-500 mb-4">or</div>
            <SyntheticDataButton onLoadSuccess={handleSyntheticSuccess} />
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

