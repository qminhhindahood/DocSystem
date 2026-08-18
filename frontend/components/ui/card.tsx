import React from 'react';
import { cn } from '../lib/cn';

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'elevated' | 'outlined' | 'public';
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    // Ordinary surfaces are flat; one boundary per hierarchy level.
    const baseStyles = 'border border-hairline bg-surface text-text-primary';

    const variants = {
      default: 'rounded-control p-4',
      flat: 'rounded-control p-4',
      // Reserved for surfaces that genuinely float above the workspace.
      elevated: 'rounded-panel p-4 shadow-floating',
      outlined: 'rounded-control p-4',
      public: 'rounded-panel p-4',
    };

    return (
      <div
        className={cn(baseStyles, variants[variant], className)}
        ref={ref}
        {...props}
      />
    );
  },
);

Card.displayName = 'Card';

export { Card };
