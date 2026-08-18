import React from 'react';
import { cn } from '../lib/cn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link' | 'ghost' | 'destructive' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const baseStyles =
      'inline-flex min-h-10 items-center justify-center gap-2 font-medium transition-all duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

    const variants = {
      primary:
        'rounded-control bg-action px-5 py-2 text-on-action hover:bg-action-hover',
      secondary:
        'rounded-control border border-border-strong bg-surface px-5 py-2 text-text-primary hover:bg-surface-strong',
      link:
        'min-h-0 rounded-control bg-transparent px-1 text-action hover:text-action-hover hover:underline',
      ghost:
        'rounded-control bg-transparent text-text-secondary hover:bg-surface-strong hover:text-text-primary',
      destructive:
        'rounded-control bg-error px-5 py-2 text-on-action hover:opacity-90 focus-visible:ring-error',
      icon:
        'w-10 rounded-compact bg-transparent p-0 text-text-secondary hover:bg-surface-strong hover:text-text-primary',
    };

    const sizes = {
      sm: 'text-control',
      md: 'text-control',
      // Primary touch target: at least 44px high.
      lg: 'min-h-11 px-7 text-body',
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && (
          <svg
            className="mr-2 h-4 w-4 animate-spin"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
