import Link from 'next/link';

export function RegistrationUnavailable() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page-title text-text-primary">Đăng ký chưa được mở</h1>
        <p className="mt-2 text-body text-text-secondary">
          Hệ thống hiện chỉ nhận tài khoản do đơn vị vận hành cấp. Nếu bạn đã có tài
          khoản, hãy quay lại trang đăng nhập.
        </p>
      </div>
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center rounded-control bg-action px-5 py-2 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
      >
        Quay lại đăng nhập
      </Link>
    </div>
  );
}
