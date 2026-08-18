import { describe, expect, it } from 'vitest';
import {
  mapStreamStageToGenerationStep,
  GENERATION_STEPS,
  getGenerationStepIndex,
  type GenerationStep,
} from '@/lib/ui/generation-stage';
import type { StreamChunk } from '@/types/api';

describe('mapStreamStageToGenerationStep', () => {
  // One assertion per member of StreamChunk['stage'].
  it.each<[NonNullable<StreamChunk['stage']>, GenerationStep]>([
    ['planning', 'compose'],
    ['researching', 'compose'],
    ['writing', 'compose'],
    ['warning', 'review'],
    ['complete', 'review'],
  ])('maps the %s stream stage to %s', (stage, step) => {
    expect(mapStreamStageToGenerationStep(stage)).toBe(step);
  });

  it('covers every declared stream stage', () => {
    const stages: Array<NonNullable<StreamChunk['stage']>> = [
      'planning',
      'researching',
      'writing',
      'complete',
      'warning',
    ];

    for (const stage of stages) {
      expect(GENERATION_STEPS.map((step) => step.id)).toContain(
        mapStreamStageToGenerationStep(stage),
      );
    }
  });

  it('never reports export from a stream stage, since the user enters export', () => {
    const stages: Array<NonNullable<StreamChunk['stage']>> = [
      'planning',
      'researching',
      'writing',
      'complete',
      'warning',
    ];

    for (const stage of stages) {
      expect(mapStreamStageToGenerationStep(stage)).not.toBe('export');
    }
  });
});

describe('GENERATION_STEPS', () => {
  it('declares the four localized stages in order', () => {
    expect(GENERATION_STEPS).toEqual([
      { id: 'setup', label: 'Thiết lập' },
      { id: 'compose', label: 'Soạn nội dung' },
      { id: 'review', label: 'Kiểm tra' },
      { id: 'export', label: 'Xuất tài liệu' },
    ]);
  });
});

describe('getGenerationStepIndex', () => {
  it('returns the ordinal position of each step', () => {
    expect(getGenerationStepIndex('setup')).toBe(0);
    expect(getGenerationStepIndex('compose')).toBe(1);
    expect(getGenerationStepIndex('review')).toBe(2);
    expect(getGenerationStepIndex('export')).toBe(3);
  });
});
