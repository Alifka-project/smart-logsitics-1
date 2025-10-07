import React from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import DeliveryCard from './DeliveryCard';

export default function DeliveryTable({ onSelectDelivery }) {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const selectDelivery = useDeliveryStore((state) => state.selectDelivery);

  const handleClick = (delivery) => {
    selectDelivery(delivery.id);
    onSelectDelivery();
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        Delivery Sequence (Sorted by Distance)
      </h2>
      <div className="space-y-4">
        {deliveries.map((delivery, index) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            index={index}
            onClick={() => handleClick(delivery)}
          />
        ))}
      </div>
    </div>
  );
}

