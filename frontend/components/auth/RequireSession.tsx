'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PROTECTED_PATHS = ['/dashboard', '/generate', '/documents', '/qa', '/templates', '/settings'];
const AUTH_PATHS = ['/login', '/signup'];

export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== 'loading') {
      const isProtected = PROTECTED_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );
      const isAuth = AUTH_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
      );

      if (status === 'anonymous' && isProtected) {
        const returnTo = encodeURIComponent(pathname);
        router.replace(`/login?returnTo=${returnTo}`);
      } else if (status === 'authenticated' && isAuth) {
        router.replace('/dashboard');
      }
    }
  }, [status, pathname, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status">
        <div className="w-8 h-8 border-2 border-focus border-t-transparent rounded-pill animate-spin" />
        <span className="sr-only">Loading session...</span>
      </div>
    );
  }

  return <>{children}</>;
}
