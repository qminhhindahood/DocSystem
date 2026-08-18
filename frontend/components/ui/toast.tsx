'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/components/lib/cn';

type ToastVariant = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

declare global {
  interface Window { __TOAST__?: (toast: Omit<Toast, 'id'>) => void; }
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
};

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-success/35 bg-success-surface',
  warning: 'border-warning/35 bg-warning-surface',
  error: 'border-error/35 bg-error-surface',
  info: 'border-info/35 bg-info-surface',
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `toast-${++counter}`;
      const duration = t.duration ?? 5000;
      setToasts((prev) => [...prev, { ...t, id }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  // Expose toast globally for non-React usage (e.g., API errors)
  useEffect(() => {
    window.__TOAST__ = toast;
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              role="alert"
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-control border p-4 shadow-floating animate-fade-in',
                VARIANT_STYLES[t.variant],
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 flex-shrink-0 mt-0.5',
                  t.variant === 'success' && 'text-success',
                  t.variant === 'warning' && 'text-warning',
                  t.variant === 'error' && 'text-error',
                  t.variant === 'info' && 'text-info',
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-control font-semibold text-text-primary">{t.title}</p>
                {t.description && (
                  <p className="mt-1 text-metadata text-text-secondary">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Đóng"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-strong hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
