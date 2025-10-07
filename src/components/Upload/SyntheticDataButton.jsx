import React from 'react';
import { Database } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { generateSyntheticData } from '../../data/syntheticData';

export default function SyntheticDataButton() {
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);

  const handleLoadData = () => {
    const data = generateSyntheticData();
    loadDeliveries(data);
  };

  return (
    <button
      onClick={handleLoadData}
      className="inline-flex items-center gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-lg hover:shadow-lg transform hover:-translate-y-0.5 transition-all text-sm sm:text-base"
    >
      <Database className="w-4 h-4 sm:w-5 sm:h-5" />
      Load Synthetic Data
    </button>
  );
}

