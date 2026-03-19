import React, { useEffect } from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import DeliveryCard from './DeliveryCard';
import type { Delivery } from '../../types';

interface DeliveryTableProps {
  onSelectDelivery: () => void;
  onCloseDetailModal?: () => void;
  onHoverDelivery?: (index: number | null) => void;
}

const ACTIVE_STATUSES = ['pending', 'out-for-delivery', 'in-transit', 'scheduled', 'confirmed'];

export default function DeliveryTable({
  onSelectDelivery,
  onCloseDetailModal,
  onHoverDelivery,
}: DeliveryTableProps) {
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
  } = useDragAndDrop<Delivery>(deliveries);

  useEffect(() => {
    setItems(deliveries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries]);

  const handleCardDrop = (): void => {
    handleDrop(undefined, (newItems) => {
      if (Array.isArray(newItems) && newItems.length > 0) {
        updateDeliveryOrder(newItems);
      }
    });
  };

  const handleClick = (delivery: Delivery): void => {
    // Mirror JSX behavior: pass through `undefined` when delivery.id is missing.
    selectDelivery(delivery.id as any);
    onSelectDelivery();
  };

  const activeItems = items.filter((delivery) => {
    const status = (delivery.status || '').toLowerCase();
    if (!status) return true;
    return ACTIVE_STATUSES.includes(status);
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
