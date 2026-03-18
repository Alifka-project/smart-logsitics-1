import { useState } from 'react';
import type { Toast, ToastType } from '../types';

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (
    title: string,
    type: ToastType = 'info',
    message = '',
    metadata = '',
    duration = 5000,
  ): number => {
    const id = Date.now();
    const toast: Toast = { id, title, message, type, metadata };

    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  };

  const removeToast = (id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const success = (title: string, message = '', metadata = '', duration = 4000) =>
    addToast(title, 'success', message, metadata, duration);
  const error = (title: string, message = '', metadata = '', duration = 6000) =>
    addToast(title, 'error', message, metadata, duration);
  const warning = (title: string, message = '', metadata = '', duration = 5000) =>
    addToast(title, 'warning', message, metadata, duration);
  const info = (title: string, message = '', metadata = '', duration = 5000) =>
    addToast(title, 'info', message, metadata, duration);

  return { toasts, addToast, removeToast, success, error, warning, info };
}
