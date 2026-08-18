'use client';

import React from 'react';
import { ThemeProvider as NextThemeProvider } from 'next-themes';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    // Light mode is the product default; a manual choice still persists.
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
