import React from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface InlineAlertProps {
  variant: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const ICONS: Record<InlineAlertProps['variant'], React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const SURFACES: Record<InlineAlertProps['variant'], string> = {
  info: 'border-info/35 bg-info-surface',
  success: 'border-success/35 bg-success-surface',
  warning: 'border-warning/35 bg-warning-surface',
  error: 'border-error/35 bg-error-surface',
};

const ICON_TONES: Record<InlineAlertProps['variant'], string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

/**
 * A persistent, non-transient message. Errors assert immediately; other variants
 * announce politely. State is carried by icon and text, never by color alone.
 */
export function InlineAlert({
  variant,
  title,
  children,
  action,
  className,
}: InlineAlertProps) {
  const Icon = ICONS[variant];

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-control border p-4',
        SURFACES[variant],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('mt-0.5 flex-shrink-0', ICON_TONES[variant])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        {title && (
          <p className="text-control font-semibold text-text-primary">{title}</p>
        )}
        <div className={cn('text-metadata text-text-secondary', title && 'mt-1')}>
          {children}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
