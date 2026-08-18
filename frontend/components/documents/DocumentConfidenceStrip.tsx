import React from 'react';
import { cn } from '@/components/lib/cn';
import type { DocumentDetail } from '@/lib/api';

export interface ConfidenceItem {
  id: 'template' | 'sources' | 'generation' | 'validation' | 'fidelity' | 'checked';
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'warning';
}

export interface DocumentConfidenceStripProps {
  items: ConfidenceItem[];
  action?: React.ReactNode;
  className?: string;
}

const TONES: Record<NonNullable<ConfidenceItem['tone']>, string> = {
  neutral: 'text-text-primary',
  positive: 'text-success',
  warning: 'text-warning',
};

type GenerationMetadata = NonNullable<DocumentDetail['metadata']>['generation'];

/**
 * Builds the trust summary from real generation metadata only.
 *
 * Anything the backend did not supply is omitted rather than guessed: there is no
 * template name, source count, or check timestamp in `DocumentDetail`, so those
 * items never appear from this path. Unavailable validation is never reported as
 * passed.
 */
export function buildDocumentConfidenceItems(
  generation: GenerationMetadata | null | undefined,
): ConfidenceItem[] {
  if (!generation) return [];

  const items: ConfidenceItem[] = [];

  if (generation.state) {
    items.push({
      id: 'generation',
      label: 'Trạng thái tạo',
      value: generation.state === 'verified' ? 'Đã xác minh' : 'Chưa xác minh',
      tone: generation.state === 'verified' ? 'positive' : 'warning',
    });
  }

  const validationStatus = generation.validationStatus ?? generation.fidelityReport?.validationStatus;
  if (validationStatus) {
    const presentation = {
      passed: { value: 'Đã đạt', tone: 'positive' as const },
      warnings: { value: 'Có cảnh báo', tone: 'warning' as const },
      unavailable: { value: 'Không kiểm tra được', tone: 'neutral' as const },
    }[validationStatus];

    items.push({
      id: 'validation',
      label: 'Kiểm tra bố cục',
      value: presentation.value,
      tone: presentation.tone,
    });
  }

  const warnings = generation.fidelityReport?.warnings;
  if (warnings && warnings.length > 0) {
    items.push({
      id: 'fidelity',
      label: 'Cảnh báo bố cục',
      value: String(warnings.length),
      tone: 'warning',
    });
  }

  return items;
}

/**
 * A compact, conditional trust summary. Renders nothing when no trustworthy values
 * exist, so an absent backend field never becomes a visual claim.
 */
export function DocumentConfidenceStrip({
  items,
  action,
  className,
}: DocumentConfidenceStripProps) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Thông tin tin cậy của tài liệu"
      className={cn(
        'flex flex-col gap-3 rounded-panel border border-hairline bg-surface-subtle px-4 py-3',
        'sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <dl className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-baseline gap-2 sm:flex-col sm:gap-0.5">
            <dt className="text-metadata text-text-muted">{item.label}</dt>
            <dd className={cn('text-control font-semibold', TONES[item.tone ?? 'neutral'])}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {action && <div className="flex-shrink-0">{action}</div>}
    </section>
  );
}
