import { describe, expect, it } from 'vitest';
import {
  getDocumentStatusPresentation,
  DOCUMENT_STATUS_FILTER_OPTIONS,
} from '@/lib/ui/document-status';

describe('getDocumentStatusPresentation', () => {
  // Statuses the backend actually writes (prisma default `draft`, rag upload path
  // `uploaded`) plus the values named in the schema contract.
  it.each([
    ['draft', { label: 'Bản nháp', variant: 'info' }],
    ['final', { label: 'Hoàn chỉnh', variant: 'success' }],
    ['uploaded', { label: 'Đã tải lên', variant: 'neutral' }],
    ['pending', { label: 'Chờ xử lý', variant: 'warning' }],
    ['approved', { label: 'Đã phê duyệt', variant: 'success' }],
    ['published', { label: 'Đã ban hành', variant: 'success' }],
  ])('maps %s to a localized presentation', (status, expected) => {
    expect(getDocumentStatusPresentation(status)).toEqual(expected);
  });

  it('falls back to a neutral localized label for unknown statuses', () => {
    expect(getDocumentStatusPresentation('unexpected')).toEqual({
      label: 'Trạng thái khác',
      variant: 'neutral',
    });
  });

  it('normalizes casing and surrounding whitespace', () => {
    expect(getDocumentStatusPresentation('  DRAFT ')).toEqual({
      label: 'Bản nháp',
      variant: 'info',
    });
  });

  it('treats an empty status as unknown rather than throwing', () => {
    expect(getDocumentStatusPresentation('')).toEqual({
      label: 'Trạng thái khác',
      variant: 'neutral',
    });
  });

  it('offers filter options backed by real statuses only', () => {
    const values = DOCUMENT_STATUS_FILTER_OPTIONS.map((option) => option.value);

    expect(values[0]).toBe('');
    expect(values).toContain('draft');
    expect(values).toContain('final');
    // No sort or archive contract exists, so no such filter may appear.
    expect(values).not.toContain('archived');
  });
});
