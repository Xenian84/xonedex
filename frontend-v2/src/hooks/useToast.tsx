/**
 * Hook for managing toast notifications
 */

import { useState, useCallback } from 'react';

export interface ToastData {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  txSignature?: string;
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showInfo = useCallback((title: string, message?: string) => {
    return showToast({ type: 'info', title, message });
  }, [showToast]);

  const showSuccess = useCallback((title: string, message?: string, txSignature?: string) => {
    return showToast({ type: 'success', title, message, txSignature });
  }, [showToast]);

  const showError = useCallback((title: string, message?: string) => {
    return showToast({ type: 'error', title, message, duration: 10000 });
  }, [showToast]);

  const showWarning = useCallback((title: string, message?: string) => {
    return showToast({ type: 'warning', title, message });
  }, [showToast]);

  return {
    toasts,
    showToast,
    hideToast,
    showInfo,
    showSuccess,
    showError,
    showWarning,
  };
}

