import Link from "next/link";
import { FileSearch } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-panel border border-hairline bg-surface p-6 text-center sm:p-8">
        <span aria-hidden="true" className="mx-auto mb-4 flex justify-center text-text-muted">
          <FileSearch className="h-8 w-8" />
        </span>
        <h1 className="text-page-title text-text-primary">Không tìm thấy trang</h1>
        <p className="mt-2 text-body text-text-secondary">
          Trang bạn đang tìm không tồn tại hoặc đã được chuyển sang địa chỉ khác.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-control bg-action px-5 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
          >
            Về trang chủ
          </Link>
          <Link
            href="/convert"
            className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-5 text-control font-medium text-text-primary transition-colors duration-fast hover:bg-surface-strong"
          >
            Chuyển đổi PDF
          </Link>
        </div>
      </div>
    </div>
  );
}
