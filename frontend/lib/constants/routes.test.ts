import { describe, expect, it } from 'vitest';
import { getRouteLabel, NAV_ROUTES } from './routes';

describe('shared route labels', () => {
  it.each([
    ['/dashboard', 'Tổng quan'],
    ['/generate', 'Tạo văn bản'],
    ['/documents', 'Tài liệu'],
    ['/documents/abc', 'Tài liệu'],
    ['/templates/new', 'Mẫu văn bản'],
    ['/qa/history', 'Tra cứu'],
  ])('labels %s as %s', (path, label) => {
    expect(getRouteLabel(path)).toBe(label);
  });

  it('does not include the retired settings route', () => {
    expect(NAV_ROUTES.map((route) => route.href as string)).not.toContain('/settings');
  });
});
