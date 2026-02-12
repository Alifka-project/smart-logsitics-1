import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, X, MessageSquare, Package, Bell } from 'lucide-react';

export function Toast({ message, type, title, metadata, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const styles = {
    success: {
      container: 'bg-gradient-to-r from-green-500 to-green-600 border-green-400',
      icon: <CheckCircle className="w-6 h-6 text-white" />,
      text: 'text-white'
    },
    error: {
      container: 'bg-gradient-to-r from-red-500 to-red-600 border-red-400',
      icon: <AlertCircle className="w-6 h-6 text-white" />,
      text: 'text-white'
    },
    warning: {
      container: 'bg-gradient-to-r from-amber-500 to-amber-600 border-amber-400',
      icon: <AlertTriangle className="w-6 h-6 text-white" />,
      text: 'text-white'
    },
    info: {
      container: 'bg-gradient-to-r from-primary-600 to-primary-700 border-primary-500',
      icon: <Bell className="w-6 h-6 text-white" />,
      text: 'text-white'
    },
    message: {
      container: 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-500',
      icon: <MessageSquare className="w-6 h-6 text-white" />,
      text: 'text-white'
    },
    delivery: {
      container: 'bg-gradient-to-r from-purple-600 to-purple-700 border-purple-500',
      icon: <Package className="w-6 h-6 text-white" />,
      text: 'text-white'
    }
  };

  const style = styles[type] || styles.info;

  return (
    <div className={`${style.container} border-2 rounded-xl p-4 shadow-2xl animate-slide-in backdrop-blur-sm min-w-[320px] max-w-md`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {style.icon}
        </div>
        <div className={`flex-1 ${style.text}`}>
          {title && (
            <div className="font-bold text-base mb-1 leading-tight">
              {title}
            </div>
          )}
          <div className="text-sm opacity-95 leading-snug">
            {message}
          </div>
          {metadata && (
            <div className="text-xs opacity-80 mt-2 border-t border-white/20 pt-2">
              {metadata}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className={`flex-shrink-0 ${style.text} hover:opacity-70 transition-opacity p-1 rounded-lg hover:bg-white/10`}
          aria-label="Close notification"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed top-20 right-4 z-[9999] space-y-3 max-w-md">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          title={toast.title}
          metadata={toast.metadata}
          onClose={() => onRemove(toast.id)}
        />
      ))}
    </div>
  );
}
