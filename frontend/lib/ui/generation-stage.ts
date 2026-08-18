import type { StreamChunk } from '@/types/api';

export type GenerationStep = 'setup' | 'compose' | 'review' | 'export';

export const GENERATION_STEPS: ReadonlyArray<{ id: GenerationStep; label: string }> = [
  { id: 'setup', label: 'Thiết lập' },
  { id: 'compose', label: 'Soạn nội dung' },
  { id: 'review', label: 'Kiểm tra' },
  { id: 'export', label: 'Xuất tài liệu' },
];

/**
 * Presentation-only mapping from the SSE stage contract to the four visible stages.
 * The stream contract itself is unchanged.
 *
 * `complete` maps to `review`, not `export`: finishing generation means there is
 * something to check, and the user enters export deliberately.
 */
export function mapStreamStageToGenerationStep(
  stage: NonNullable<StreamChunk['stage']>,
): GenerationStep {
  switch (stage) {
    case 'planning':
    case 'researching':
    case 'writing':
      return 'compose';
    case 'warning':
    case 'complete':
      return 'review';
  }
}

export function getGenerationStepIndex(step: GenerationStep): number {
  return GENERATION_STEPS.findIndex((entry) => entry.id === step);
}

const STREAM_STAGES: ReadonlyArray<NonNullable<StreamChunk['stage']>> = [
  'planning',
  'researching',
  'writing',
  'complete',
  'warning',
];

/** Narrows an arbitrary stage string from the stream to the declared contract. */
export function isStreamStage(value: string): value is NonNullable<StreamChunk['stage']> {
  return (STREAM_STAGES as ReadonlyArray<string>).includes(value);
}
