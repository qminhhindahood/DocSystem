import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map(value => Number.parseInt(value, 16) / 255) ?? [];
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

function themeTokens(theme: 'light' | 'dark'): Record<string, string> {
  const start = theme === 'light'
    ? css.indexOf(':root')
    : css.indexOf('[data-theme="dark"]');
  const block = css.slice(start, css.indexOf('}', start));

  return Object.fromEntries(
    Array.from(
      block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi),
      match => [match[1]?.replace(/^color-/, '') ?? '', match[2] ?? ''],
    ),
  );
}

// Text/background pairs that must stay readable in both themes.
const pairs: Array<[string, string]> = [
  ['text-primary', 'canvas'],
  ['text-primary', 'workspace'],
  ['text-secondary', 'workspace'],
  ['text-secondary', 'surface-strong'],
  ['text-muted', 'workspace'],
  ['text-muted', 'surface-strong'],
  ['text-muted', 'surface-subtle'],
  ['action-text', 'workspace'],
  ['action-text', 'surface-strong'],
  ['action-text-hover', 'surface-strong'],
  ['link', 'canvas'],
  ['link', 'workspace'],
  ['on-action', 'action'],
  ['on-action', 'action-hover'],
  ['success-text', 'success-surface'],
  ['warning-text', 'warning-surface'],
  ['error-text', 'error-surface'],
  ['info-text', 'info-surface'],
];

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  it('keeps text, semantic, and action pairs at WCAG 2.2 AA', () => {
    const tokens = themeTokens(theme);
    const token = (name: string): string => {
      const value = tokens[name];
      if (!value) throw new Error(`Missing ${name} token in ${theme} theme`);
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      return value;
    };

    for (const [foreground, background] of pairs) {
      expect(
        contrast(token(foreground), token(background)),
        `${theme}: ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // WCAG 2.2 1.4.11 applies 3:1 to focus indicators, not decorative hairlines.
  it('keeps the focus ring visible against canvas and workspace at 3:1', () => {
    const tokens = themeTokens(theme);

    for (const background of ['canvas', 'workspace'] as const) {
      expect(
        contrast(tokens['focus'] ?? '', tokens[background] ?? ''),
        `${theme}: focus on ${background}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('placeholder contract', () => {
  it('renders placeholders with the muted token at full opacity', () => {
    expect(css).toMatch(/input::placeholder,[\s\S]*color: var\(--color-text-muted\)/);
  });
});
