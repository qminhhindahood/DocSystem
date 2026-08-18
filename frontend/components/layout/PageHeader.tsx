import React from 'react';
import { cn } from '@/components/lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * The single route-level heading for a workspace page. Route title and actions
 * live inside the workspace, not in a second global header.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b border-hairline pb-5 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-page-title text-text-primary">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[70ch] text-metadata text-text-secondary">
            {description}
          </p>
        )}
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-metadata text-text-muted">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
