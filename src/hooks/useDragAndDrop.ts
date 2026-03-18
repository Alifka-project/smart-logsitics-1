import { useState } from 'react';

export function useDragAndDrop<T>(initialItems: T[] = []) {
  const [items, setItems] = useState<T[]>(initialItems);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number): void => {
    setDraggedIndex(index);
  };

  const handleDragOver = (index: number): void => {
    setDragOverIndex(index);
  };

  const handleDragLeave = (): void => {
    setDragOverIndex(null);
  };

  const handleDrop = (dropIndex: number | null, onReorder?: (items: T[]) => void): void => {
    const targetIndex =
      typeof dropIndex === 'number' ? dropIndex : (dragOverIndex ?? draggedIndex);

    if (draggedIndex === null || targetIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];

    newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);

    setItems(newItems);
    if (typeof onReorder === 'function') {
      onReorder(newItems);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleTouchStart = (index: number): void => {
    setDraggedIndex(index);
  };

  const handleTouchMove = (index: number): void => {
    setDragOverIndex(index);
  };

  const handleTouchEnd = (onReorder?: (items: T[]) => void): void => {
    if (draggedIndex !== null && dragOverIndex !== null) {
      handleDrop(dragOverIndex, onReorder);
    } else {
      setDraggedIndex(null);
      setDragOverIndex(null);
    }
  };

  return {
    items,
    setItems,
    draggedIndex,
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
