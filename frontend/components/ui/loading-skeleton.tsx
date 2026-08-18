import React from 'react';
import { cn } from '@/components/lib/cn';

export interface LoadingSkeletonProps {
  rows?: number;
  label?: string;
  className?: string;
}

/**
 * Placeholder bars are hidden from assistive technology; the container carries a
 * Vietnamese loading label so screen readers hear the state, not the shape.
 */
export function LoadingSkeleton({
  rows = 3,
  label = 'Đang tải',
  className,
}: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn('flex flex-col gap-2', className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="skeleton h-11 w-full"
        />
      ))}
    </div>
  );
}
