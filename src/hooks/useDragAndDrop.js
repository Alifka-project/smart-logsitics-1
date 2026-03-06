import { useState } from 'react';

export function useDragAndDrop(initialItems = []) {
  const [items, setItems] = useState(initialItems);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (index) => {
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (dropIndex, onReorder) => {
    // Prefer explicit dropIndex if provided, otherwise fall back to
    // the last dragOverIndex (the card we are hovering on).
    const targetIndex = typeof dropIndex === 'number' ? dropIndex : (dragOverIndex ?? draggedIndex);

    if (draggedIndex === null || targetIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];
    
    // Remove from old position
    newItems.splice(draggedIndex, 1);
    // Insert at new position
    newItems.splice(targetIndex, 0, draggedItem);
    
    setItems(newItems);
    if (typeof onReorder === 'function') {
      onReorder(newItems);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleTouchStart = (index) => {
    setDraggedIndex(index);
  };

  const handleTouchMove = (index) => {
    setDragOverIndex(index);
  };

  const handleTouchEnd = (onReorder) => {
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
