'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/components/lib/cn';
import {
  GENERATION_STEPS,
  getGenerationStepIndex,
  type GenerationStep,
} from '@/lib/ui/generation-stage';

export interface GenerationStagesProps {
  current: GenerationStep;
  className?: string;
}

/**
 * The four visible generation stages. Current and completed steps are marked with
 * text and an icon, never by color alone. On mobile only the current step plus a
 * `Bước n / 4` counter is shown so nothing overflows horizontally.
 */
export function GenerationStages({ current, className }: GenerationStagesProps) {
  const currentIndex = getGenerationStepIndex(current);
  const currentStep = GENERATION_STEPS[currentIndex];

  return (
    <div className={className}>
      {/* Mobile: current step only. */}
      <p className="text-control text-text-secondary sm:hidden">
        <span className="font-semibold text-text-primary">{currentStep?.label}</span>
        <span className="ml-2 text-metadata text-text-muted numeric">
          Bước {currentIndex + 1} / {GENERATION_STEPS.length}
        </span>
      </p>

      <ol className="hidden items-center gap-2 sm:flex" aria-label="Tiến trình tạo văn bản">
        {GENERATION_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-control',
                  isCurrent && 'bg-action-tint font-semibold text-action',
                  isComplete && 'text-success',
                  !isCurrent && !isComplete && 'text-text-muted',
                )}
              >
                {isComplete ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <span aria-hidden="true" className="numeric">{index + 1}.</span>
                )}
                {step.label}
                {/* State is announced in text, not conveyed by color alone. */}
                {isComplete && <span className="sr-only">(đã xong)</span>}
                {isCurrent && <span className="sr-only">(đang thực hiện)</span>}
              </span>
              {index < GENERATION_STEPS.length - 1 && (
                <span aria-hidden="true" className="h-px w-4 bg-hairline" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
