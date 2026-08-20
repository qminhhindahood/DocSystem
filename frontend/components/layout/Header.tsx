'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/components/lib/cn';
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { getRouteLabel } from '@/lib/constants/routes';

interface HeaderProps {
  onMenuClick?: () => void;
  className?: string;
  sidebarOpen?: boolean;
  menuButtonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * Mobile-only header. At desktop widths the sidebar carries navigation and the
 * workspace header carries the route title, so no second global header exists.
 */
export function Header({ onMenuClick, className, sidebarOpen, menuButtonRef }: HeaderProps) {
  const pathname = usePathname();
  const pageLabel = getRouteLabel(pathname);

  return (
    <header
      data-testid="mobile-header"
      className={cn(
        'sticky top-0 z-sticky flex h-[52px] items-center gap-2 border-b border-hairline bg-surface px-2 lg:hidden',
        className,
      )}
    >
      <button
        ref={menuButtonRef}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-compact text-text-secondary transition-colors hover:bg-surface-strong hover:text-text-primary"
        onClick={onMenuClick}
        aria-label="Mở điều hướng"
        aria-expanded={sidebarOpen}
        aria-controls="sidebar-nav"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Link href="/convert" className="flex min-h-11 min-w-0 items-center gap-2">
        <span className="text-control font-semibold text-text-primary">DocAI</span>
        <span aria-hidden="true" className="text-text-muted">
          /
        </span>
        <span className="truncate text-control text-text-secondary">{pageLabel}</span>
      </Link>
    </header>
  );
}
