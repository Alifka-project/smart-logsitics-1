import React, { useEffect } from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import DeliveryCard from './DeliveryCard';

export default function DeliveryTable({ onSelectDelivery }) {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const updateDeliveryOrder = useDeliveryStore((state) => state.updateDeliveryOrder);
  const selectDelivery = useDeliveryStore((state) => state.selectDelivery);

  const {
    items,
    setItems,
    draggedIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragAndDrop(deliveries);

  // Update local items when deliveries change from store
  useEffect(() => {
    setItems(deliveries);
  }, [deliveries, setItems]);

  const handleCardDrop = (dropIndex) => {
    handleDrop(dropIndex);
    // Save the new order to the store
    if (items.length > 0 && items !== deliveries) {
      updateDeliveryOrder(items);
    }
  };

  const handleClick = (delivery) => {
    selectDelivery(delivery.id);
    onSelectDelivery();
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg sm:text-2xl font-bold text-gray-800 mb-2">
          🚚 Delivery Sequence
        </h2>
        <p className="text-xs sm:text-sm text-gray-600">
          Drag to reorder • Tap to edit • Sorted by distance
        </p>
      </div>

      <div className="space-y-2 sm:space-y-3">
        {items.map((delivery, index) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            index={index}
            onClick={() => handleClick(delivery)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleCardDrop}
            isDragging={draggedIndex === index}
            isDragOver={dragOverIndex === index}
          />
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No deliveries loaded yet
        </div>
      )}
    </div>
  );
}

