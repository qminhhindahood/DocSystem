'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div
        role="alert"
        className="w-full max-w-md rounded-panel border border-hairline bg-surface p-6 text-center sm:p-8"
      >
        {/* Standalone page: the top heading must be level 1. */}
        <h1 className="text-page-title text-text-primary">Đã xảy ra lỗi</h1>
        <p className="mt-2 text-body text-text-secondary">
          Không thể tải trang. Vui lòng thử lại.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" onClick={reset}>
            Thử lại
          </Button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-5 text-control font-medium text-text-primary transition-colors duration-fast hover:bg-surface-strong"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
