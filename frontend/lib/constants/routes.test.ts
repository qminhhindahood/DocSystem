import { describe, expect, it } from 'vitest';
import { getRouteLabel, NAV_ROUTES } from './routes';

describe('shared route labels', () => {
  it.each([
    ['/convert', 'Chuyển đổi PDF'],
    ['/convert/anything', 'Chuyển đổi PDF'],
  ])('labels %s as %s', (path, label) => {
    expect(getRouteLabel(path)).toBe(label);
  });

  it('navigates only to the convert surface', () => {
    expect(NAV_ROUTES.map((route) => route.href as string)).toEqual(['/convert']);
  });

  it('does not include retired master-stack routes', () => {
    const hrefs = NAV_ROUTES.map((route) => route.href as string);
    for (const dead of ['/dashboard', '/generate', '/documents', '/templates', '/qa', '/settings']) {
      expect(hrefs).not.toContain(dead);
    }
  });
});
