import React, { useEffect, useMemo } from 'react';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import DeliveryCard from './DeliveryCard';
import type { Delivery } from '../../types';
import {
  applyDeliveryListFilter,
  countForDeliveryListFilter,
  type DeliveryListFilter,
  getActiveDeliveriesForList,
  isActiveDeliveryListStatus,
} from '../../utils/deliveryListFilter';

interface DeliveryTableProps {
  onSelectDelivery: () => void;
  onCloseDetailModal?: () => void;
  onHoverDelivery?: (index: number | null) => void;
}

export default function DeliveryTable({
  onSelectDelivery,
  onCloseDetailModal,
  onHoverDelivery,
}: DeliveryTableProps) {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const deliveryListFilter = useDeliveryStore((state) => state.deliveryListFilter);
  const setDeliveryListFilter = useDeliveryStore((state) => state.setDeliveryListFilter);
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

  const activeFromItems = useMemo(
    () => items.filter((d) => isActiveDeliveryListStatus((d.status || '').toLowerCase())),
    [items],
  );

  const rows = useMemo(() => {
    if (deliveryListFilter === 'all') {
      return activeFromItems.map((delivery, displayIndex) => ({
        delivery,
        displayIndex,
        dragIndex: items.findIndex((x) => x.id === delivery.id),
      }));
    }
    const list = applyDeliveryListFilter(deliveries, deliveryListFilter);
    return list.map((delivery, displayIndex) => ({
      delivery,
      displayIndex,
      dragIndex: undefined as number | undefined,
    }));
  }, [activeFromItems, deliveries, deliveryListFilter, items]);

  const dragEnabled = deliveryListFilter === 'all';

  const handleCardDrop = (): void => {
    if (!dragEnabled) return;
    handleDrop(undefined, (newItems) => {
      if (Array.isArray(newItems) && newItems.length > 0) {
        updateDeliveryOrder(newItems);
      }
    });
  };

  const handleClick = (delivery: Delivery): void => {
    selectDelivery(delivery.id as string);
    onSelectDelivery();
  };

  const chips: { id: DeliveryListFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'p1', label: 'P1 Only' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 transition-colors">
      <div className="mb-4">
        <h2 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          🚚 Delivery Sequence
        </h2>
        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3">
          {dragEnabled ? 'Drag to reorder • ' : 'Clear filters to reorder • '}
          Tap to edit • Sorted by distance
        </p>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const count = countForDeliveryListFilter(deliveries, c.id);
            const active = deliveryListFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDeliveryListFilter(c.id)}
                className={`text-xs sm:text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                {c.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 sm:space-y-3">
        {rows.map(({ delivery, displayIndex, dragIndex }) => {
          const dIdx = dragIndex ?? -1;
          const canDrag = dragEnabled && dIdx >= 0;
          return (
            <DeliveryCard
              key={delivery.id}
              delivery={delivery}
              displayIndex={displayIndex}
              dragIndex={canDrag ? dIdx : undefined}
              dragDisabled={!canDrag}
              onClick={() => handleClick(delivery)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleCardDrop}
              isDragging={canDrag && draggedIndex === dIdx}
              isDragOver={canDrag && dragOverIndex === dIdx}
              onCloseDetailModal={onCloseDetailModal}
              onMouseEnter={() => onHoverDelivery?.(displayIndex)}
              onMouseLeave={() => onHoverDelivery?.(null)}
            />
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No active deliveries for this filter. Completed or cancelled stops are hidden from this list.
        </div>
      )}
    </div>
  );
}
