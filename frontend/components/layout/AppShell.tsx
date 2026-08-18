'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ToastProvider } from '@/components/ui/toast';
import { PageTracker } from '@/components/analytics/PageTracker';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setSidebarOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <ToastProvider>
      {/* Quiet outer canvas with 16px padding at desktop widths. */}
      <div className="min-h-screen bg-canvas text-text-primary lg:p-4">
        <div id="sidebar-nav">
          <Sidebar
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            triggerRef={menuButtonRef}
          />
        </div>

        {/* 256px sidebar + 16px gutter clears the fixed rail at desktop widths. */}
        <div
          className="flex min-h-screen flex-col lg:min-h-0 lg:pl-[272px]"
          inert={sidebarOpen || undefined}
          aria-hidden={sidebarOpen || undefined}
        >
          <a href="#main-content" className="skip-link">
            Bỏ qua tới nội dung chính
          </a>
          <a href="#sidebar-nav" className="skip-link">
            Bỏ qua tới điều hướng
          </a>

          {/* Mobile-only header; the desktop workspace owns the route title. */}
          <Header
            onMenuClick={() => setSidebarOpen(true)}
            sidebarOpen={sidebarOpen}
            menuButtonRef={menuButtonRef}
          />

          {/* One rounded workspace holds the current task. */}
          <div
            data-testid="app-workspace"
            className="flex flex-1 flex-col overflow-hidden bg-workspace lg:min-h-[calc(100dvh-32px)] lg:rounded-workspace lg:shadow-workspace"
          >
            <main id="main-content" className="relative flex-1 overflow-y-auto">
              {children}
              <PageTracker />
            </main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
