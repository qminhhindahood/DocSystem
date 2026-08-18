import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Be_Vietnam_Pro: () => ({ variable: 'be-vietnam-variable' }),
  JetBrains_Mono: () => ({ variable: 'jetbrains-variable' }),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/providers/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('RootLayout', () => {
  it('defines both font variables on the root element where the design tokens resolve', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(<RootLayout><p>Nội dung</p></RootLayout>);

    expect(html).toMatch(/<html[^>]*class="[^"]*be-vietnam-variable[^"]*jetbrains-variable/);
    expect(html).not.toMatch(/<body[^>]*class="[^"]*(be-vietnam-variable|jetbrains-variable)/);
  });

  it('uses localized default browser metadata', async () => {
    const { metadata } = await import('@/app/layout');

    expect(metadata.title).toBe('DocAI — Soạn thảo văn bản hành chính');
    expect(metadata.description).toBe('Soạn thảo, quản lý và tra cứu văn bản hành chính có căn cứ.');
  });
});
