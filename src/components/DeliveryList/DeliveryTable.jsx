import React, { useEffect } from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import DeliveryCard from './DeliveryCard';

export default function DeliveryTable({ onSelectDelivery, onCloseDetailModal, onHoverDelivery }) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries]);

  const handleCardDrop = () => {
    // Delegate to hook but capture the newly ordered items.
    // The hook will use its internal dragOverIndex / draggedIndex
    // to decide the final target index.
    handleDrop(undefined, (newItems) => {
      if (Array.isArray(newItems) && newItems.length > 0) {
        updateDeliveryOrder(newItems);
      }
    });
  };

  const handleClick = (delivery) => {
    selectDelivery(delivery.id);
    onSelectDelivery();
  };

  // Only show "active" deliveries in the management list. Completed / cancelled
  // drops off this view but stays in the store for reporting.
  const ACTIVE_STATUSES = ['pending', 'out-for-delivery', 'in-transit', 'scheduled', 'confirmed'];
  const activeItems = items.filter((delivery) => {
    const status = (delivery.status || '').toLowerCase();
    if (!status) return true;
    if (ACTIVE_STATUSES.includes(status)) return true;
    return false;
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 transition-colors">
      <div className="mb-4">
        <h2 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          🚚 Delivery Sequence
        </h2>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
          Drag to reorder • Tap to edit • Sorted by distance
        </p>
      </div>

      <div className="space-y-2 sm:space-y-3">
        {activeItems.map((delivery, index) => (
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
            onCloseDetailModal={onCloseDetailModal}
            onMouseEnter={() => onHoverDelivery?.(index)}
            onMouseLeave={() => onHoverDelivery?.(null)}
          />
        ))}
      </div>

      {activeItems.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No active deliveries. Completed or cancelled stops are hidden from this list.
        </div>
      )}
    </div>
  );
}


