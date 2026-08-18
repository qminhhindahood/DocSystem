export const NAV_ROUTES = [
  { id: 'dashboard', label: 'Tổng quan', href: '/dashboard' },
  { id: 'generate', label: 'Tạo văn bản', href: '/generate' },
  { id: 'documents', label: 'Tài liệu', href: '/documents' },
  { id: 'convert', label: 'Chuyển đổi PDF', href: '/convert' },
  { id: 'templates', label: 'Mẫu văn bản', href: '/templates' },
  { id: 'qa', label: 'Tra cứu', href: '/qa' },
] as const;

export function getRouteLabel(pathname: string): string {
  const match = [...NAV_ROUTES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((route) => pathname === route.href || pathname.startsWith(`${route.href}/`));
  return match?.label || 'Tổng quan';
}
