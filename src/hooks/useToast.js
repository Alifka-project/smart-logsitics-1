import { useState } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);

const addToast = (title, type = 'info', message = '', metadata = '', duration = 5000) => {
    const id = Date.now();
    const toast = { id, title, message, type, metadata };
    
    setToasts(prev => [...prev, toast]);
    
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    
    return id;
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const success = (title, message = '', metadata = '', duration = 4000) => addToast(title, 'success', message, metadata, duration);
  const error = (title, message = '', metadata = '', duration = 6000) => addToast(title, 'error', message, metadata, duration);
  const warning = (title, message = '', metadata = '', duration = 5000) => addToast(title, 'warning', message, metadata, duration);
  const info = (title, message = '', metadata = '', duration = 5000) => addToast(title, 'info', message, metadata, duration);

  return { toasts, addToast, removeToast, success, error, warning, info };
}
