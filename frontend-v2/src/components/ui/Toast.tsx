/**
 * Toast notification component for transaction status
 */

import { useEffect } from 'react';
import { useNetworkStore } from '../../store/useNetworkStore';

export interface ToastProps {
  type: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  txSignature?: string;
  onClose: () => void;
  duration?: number;
}

export function Toast({ type, title, message, txSignature, onClose, duration = 5000 }: ToastProps) {
  const explorerUrl = useNetworkStore((state) => state.config.explorerUrl);
  
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const colors = {
    info: 'bg-[#1a1b23] border-[#2c2d3a]',
    success: 'bg-[#1a1b23] border-[#22D1F8]',
    error: 'bg-[#1a1b23] border-[#FF4EA3]',
    warning: 'bg-[#1a1b23] border-[#FED33A]',
  };

  const icons = {
    info: '🔄',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };

  return (
    <div className={`${colors[type]} border-2 rounded-xl p-3 shadow-lg min-w-[280px] max-w-sm animate-slide-in-right`}>
      <div className="flex items-start gap-2.5">
        <span className="text-xl shrink-0">{icons[type]}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-semibold text-sm mb-0.5">{title}</h4>
          {message && <p className="text-[#8e92bc] text-xs mb-1.5 line-clamp-2">{message}</p>}
          {txSignature && (
            <a
              href={`${explorerUrl}/tx/${txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#5A8FFF] hover:text-[#5A8FFF]/80 underline break-all"
            >
              View on Explorer
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[#5a5d7a] hover:text-white transition-colors shrink-0 p-1"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {children}
    </div>
  );
}

