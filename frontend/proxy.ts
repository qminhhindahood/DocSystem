import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'docai_session';
const PROTECTED_PATHS = ['/convert'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (!hasSession && isProtected) {
    const returnTo = encodeURIComponent(pathname);
    return NextResponse.redirect(new URL(`/login?returnTo=${returnTo}`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
