import React from 'react';
import { Database } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { generateSyntheticData } from '../../data/syntheticData';

interface LoadSuccessPayload {
  count: number;
  warnings: string[];
}

interface SyntheticDataButtonProps {
  onLoadSuccess?: (payload: LoadSuccessPayload) => void;
}

export default function SyntheticDataButton({ onLoadSuccess }: SyntheticDataButtonProps) {
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);

  const handleLoadData = (): void => {
    try {
      const data = generateSyntheticData();
      loadDeliveries(data as import('../../types').Delivery[]);
      if (onLoadSuccess) {
        onLoadSuccess({ count: data.length, warnings: [] });
      }
    } catch (error) {
      console.error('Error loading synthetic data:', error);
    }
  };

  return (
    <button
      onClick={handleLoadData}
      className="inline-flex items-center gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold rounded-lg hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm sm:text-base"
    >
      <Database className="w-4 h-4 sm:w-5 sm:h-5" />
      Load Synthetic Data
    </button>
  );
}
