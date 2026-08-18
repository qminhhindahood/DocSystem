import React, { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/lib/theme';

const themeState = vi.hoisted(() => ({ serverPhase: true }));

vi.mock('next-themes', () => ({
  useTheme: () => themeState.serverPhase
    ? { theme: undefined, resolvedTheme: undefined, setTheme: vi.fn() }
    : { theme: 'dark', resolvedTheme: 'dark', setTheme: vi.fn() },
}));

function ThemeProbe() {
  const { theme } = useTheme();
  return <span>{theme}</span>;
}

afterEach(() => {
  themeState.serverPhase = true;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('theme hydration', () => {
  it('keeps the first client render aligned with the server before resolving dark mode', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<ThemeProbe />);
    themeState.serverPhase = false;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      hydrateRoot(container, <ThemeProbe />);
    });

    expect(error).not.toHaveBeenCalled();
    expect(container).toHaveTextContent('dark');
  });
});
