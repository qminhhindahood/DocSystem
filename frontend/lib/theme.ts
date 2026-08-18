import { useTheme as useNextTheme } from 'next-themes';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    const current = resolvedTheme || theme;
    setTheme(current === 'dark' ? 'light' : 'dark');
  }, [theme, resolvedTheme, setTheme]);

  return {
    theme: (mounted ? resolvedTheme || theme || 'light' : 'light') as Theme,
    setTheme: (t: Theme) => setTheme(t),
    toggle,
  };
}
