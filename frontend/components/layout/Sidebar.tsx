'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/lib/cn';
import { NAV_ROUTES } from '@/lib/constants/routes';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/components/auth/AuthProvider';
import { LLMSettingsDialog } from '@/components/settings/LLMSettingsDialog';
import {
  FileOutput,
  X,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  badge?: number;
}

const ROUTE_ICONS = {
  convert: FileOutput,
};

const navItems: SidebarItem[] = NAV_ROUTES.map((route) => ({
  ...route,
  icon: ROUTE_ICONS[route.id as keyof typeof ROUTE_ICONS],
}));

interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  className?: string;
}

export function Sidebar({ open, onOpenChange, triggerRef, className }: SidebarProps) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { logout } = useAuth();
  const asideRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef?.current?.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        asideRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange, open, triggerRef]);

  const utilityClass =
    'flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-control text-text-secondary transition-colors duration-fast hover:bg-surface-strong hover:text-text-primary';

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-backdrop bg-black/55 lg:hidden"
          onClick={() => onOpenChange(false)}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        data-testid="app-sidebar"
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        aria-label="Điều hướng chính"
        className={cn(
          'fixed left-0 top-0 z-modal h-screen w-64 border-r border-hairline bg-surface transition-transform duration-standard ease-product',
          'lg:w-64 lg:translate-x-0 lg:rounded-panel lg:border-r-0 lg:top-4 lg:left-4 lg:h-[calc(100dvh-32px)] lg:border lg:border-hairline',
          open ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible lg:translate-x-0',
          className,
        )}
      >
        <div className="flex h-full flex-col">
          {/* Brand */}
          <div className="flex h-[52px] flex-shrink-0 items-center px-4 lg:h-14">
            <Link href="/convert" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-control bg-action">
                <FileOutput className="h-4 w-4 text-on-action" />
              </span>
              <span className="text-section-title text-text-primary">DocAI</span>
            </Link>
            <button
              ref={closeButtonRef}
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-compact text-text-secondary transition-colors hover:bg-surface-strong hover:text-text-primary lg:hidden"
              onClick={() => onOpenChange(false)}
              aria-label="Đóng điều hướng"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav aria-label="Điều hướng chính" className="flex-1 space-y-1 overflow-y-auto p-3">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-control transition-colors duration-fast',
                    isActive
                      ? 'bg-action-tint font-semibold text-action'
                      : 'text-text-secondary hover:bg-surface-strong hover:text-text-primary',
                  )}
                  onClick={() => onOpenChange(false)}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Footer utilities */}
          <div className="flex-shrink-0 space-y-1 border-t border-hairline p-3">
            <LLMSettingsDialog />
            {/* Visible text carries the accessible name (WCAG 2.5.3); the icon shows
                which theme the control switches to. */}
            <button type="button" onClick={toggle} className={utilityClass}>
              {theme === 'dark' ? (
                <Sun className="h-5 w-5 flex-shrink-0" />
              ) : (
                <Moon className="h-5 w-5 flex-shrink-0" />
              )}
              <span className="truncate">Chuyển giao diện</span>
            </button>
            <button type="button" onClick={() => void logout()} className={utilityClass}>
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">Đăng xuất</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
