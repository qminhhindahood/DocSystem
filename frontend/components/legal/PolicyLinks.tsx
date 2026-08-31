import Link from 'next/link';

export function PolicyLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Chính sách" className={className}>
      <Link className="hover:text-action" href="/privacy">Quyền riêng tư</Link>
      <Link className="hover:text-action" href="/terms">Điều khoản</Link>
      <Link className="hover:text-action" href="/data-handling">Xử lý dữ liệu</Link>
    </nav>
  );
}
