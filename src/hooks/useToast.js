import { useState } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info', duration = 5000) => {
    const id = Date.now();
    const toast = { id, message, type };
    
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

  const success = (message, duration = 4000) => addToast(message, 'success', duration);
  const error = (message, duration = 6000) => addToast(message, 'error', duration);
  const warning = (message, duration = 5000) => addToast(message, 'warning', duration);
  const info = (message, duration = 5000) => addToast(message, 'info', duration);

  return { toasts, addToast, removeToast, success, error, warning, info };
}
