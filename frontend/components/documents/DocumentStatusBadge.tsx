import React from 'react';
import { Badge } from '@/components/ui/badge';
import { getDocumentStatusPresentation } from '@/lib/ui/document-status';

const BADGE_VARIANTS = {
  neutral: 'default',
  info: 'info',
  success: 'success',
  warning: 'warning',
} as const;

export interface DocumentStatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * Localized status presentation. Unknown statuses fall back to a neutral label
 * rather than being rendered raw or guessed at.
 */
export function DocumentStatusBadge({ status, className }: DocumentStatusBadgeProps) {
  const { label, variant } = getDocumentStatusPresentation(status);

  return (
    <Badge variant={BADGE_VARIANTS[variant]} className={className}>
      {label}
    </Badge>
  );
}
