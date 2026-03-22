import React, { useState } from 'react';
import useDeliveryStore from '../store/useDeliveryStore';
import FileUpload from '../components/Upload/FileUpload';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import StatsCards from '../components/Analytics/StatsCards';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';

interface FileResult {
  count?: number;
  warnings?: string[];
  errors?: string[];
}

export default function DeliveryListPage(): React.ReactElement {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [showModal, setShowModal] = useState<boolean>(false);
  const { toasts, removeToast, success, error, warning } = useToast();

  const handleFileSuccess = (result: FileResult): void => {
    success(`✓ Successfully loaded ${result.count ?? 0} deliveries`);
    if (result.warnings && result.warnings.length > 0) {
      warning(`⚠ ${result.warnings.length} warning(s) found during validation`);
    }
  };

  const handleFileError = (result: FileResult): void => {
    if (result.errors && result.errors.length > 0) {
      error(`Validation failed:\n${result.errors.join('\n')}`);
    } else {
      error('Failed to process file');
    }
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
        </div>
      )}

      {/* Analytics */}
      {deliveries.length > 0 && <StatsCards />}

      {/* Delivery List */}
      {deliveries.length > 0 && (
        <DeliveryTable 
          onSelectDelivery={() => setShowModal(true)} 
          onCloseDetailModal={() => setShowModal(false)}
        />
      )}

      {/* Customer Details Modal */}
      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaveContactSuccess={(msg: string) => success(msg)}
        onSaveContactError={(msg: string) => error(msg)}
      />
    </div>
  );
}
