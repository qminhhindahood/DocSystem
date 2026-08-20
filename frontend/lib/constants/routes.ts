export const NAV_ROUTES = [
  { id: 'convert', label: 'Chuyển đổi PDF', href: '/convert' },
] as const;

export function getRouteLabel(pathname: string): string {
  const match = [...NAV_ROUTES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((route) => pathname === route.href || pathname.startsWith(`${route.href}/`));
  return match?.label || 'Chuyển đổi PDF';
}
