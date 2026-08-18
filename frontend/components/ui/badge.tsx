import React from 'react';
import { cn } from '@/components/lib/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-surface-strong text-text-primary',
      success: 'bg-success-surface text-success',
      warning: 'bg-warning-surface text-warning',
      error: 'bg-error-surface text-error',
      info: 'bg-info-surface text-info',
    };

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-metadata font-medium',
          variants[variant],
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Badge.displayName = 'Badge';

export { Badge };
