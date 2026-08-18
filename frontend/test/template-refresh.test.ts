import { describe, expect, it } from 'vitest';
import { getTemplateRefetchInterval } from '@/lib/templates-api';
import type { TemplateSummary } from '@/lib/templates-api';

const base: TemplateSummary = {
  id: 'template-1',
  name: 'Mẫu',
  docType: 'thong-bao',
  status: 'READY',
  analysisConfidence: 0.95,
  rejectionCode: null,
  rejectionReason: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  fileSize: 1024,
};

describe('template refresh interval', () => {
  it.each(['UPLOADED', 'ANALYZING'] as const)('polls while a template is %s', (status) => {
    expect(getTemplateRefetchInterval({ templates: [{ ...base, status }] })).toBe(2000);
  });

  it.each(['NEEDS_REVIEW', 'READY', 'REJECTED', 'FAILED'] as const)(
    'stops polling when a template is %s',
    (status) => {
      expect(getTemplateRefetchInterval({ templates: [{ ...base, status }] })).toBe(false);
    },
  );

  it('does not poll before data is available', () => {
    expect(getTemplateRefetchInterval()).toBe(false);
  });
});
