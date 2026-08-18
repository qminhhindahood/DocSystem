import React from 'react';
import { cn } from '@/components/lib/cn';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}

/**
 * A state-specific explanation plus one useful next action. The icon stays small
 * and decorative; the explanation carries the meaning.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-control border border-hairline bg-surface-subtle px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && (
        <span aria-hidden="true" className="text-text-muted">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <h2 className="text-section-title text-text-primary">{title}</h2>
      <p className="max-w-[52ch] text-metadata text-text-secondary">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
