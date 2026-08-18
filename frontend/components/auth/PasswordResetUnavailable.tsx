export function PasswordResetUnavailable() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page-title text-text-primary">Khôi phục mật khẩu chưa được bật</h1>
        <p className="mt-2 text-metadata text-text-secondary">
          Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.
        </p>
      </div>
      <a
        href="/login"
        className="inline-flex min-h-11 items-center font-medium text-action hover:underline"
      >
        Quay lại đăng nhập
      </a>
    </div>
  );
}
