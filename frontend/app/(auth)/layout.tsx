import Link from 'next/link';
import { RequireSession } from '@/components/auth/RequireSession';
import { AuthRise } from '@/components/auth/AuthRise';
import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <div className="grid min-h-screen bg-canvas text-text-primary lg:grid-cols-[1fr_1.1fr]">
        {/* Left Branding Panel */}
        <div className="hidden border-r border-hairline bg-surface p-12 lg:flex lg:flex-col lg:justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-section-title text-text-primary transition-colors hover:text-action"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-control bg-action text-metadata font-semibold text-on-action">
                Doc
              </span>
              DocAI
            </Link>
          </div>

          <AuthRise delay={0.05} className="max-w-lg space-y-5">
            <div className="inline-flex items-center gap-2 rounded-pill bg-action-tint px-3.5 py-1 text-metadata font-medium text-action">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Theo Nghị định 30/2020/NĐ-CP
            </div>

            <h2 className="text-page-title text-text-primary">
              Chuyển đổi PDF thành DOCX có thể kiểm tra.
            </h2>

            <p className="text-body text-text-secondary">
              Giữ nội dung nguồn, áp dụng thể thức Nghị định 30 và xem rõ độ tin cậy và độ bao
              phủ của từng kết quả.
            </p>

            <ul className="space-y-3 pt-2 text-control text-text-secondary">
              {[
                'Chuyển đổi PDF văn bản hành chính thành DOCX',
                'Áp dụng thể thức bằng quy tắc, không để AI quyết định định dạng',
                'Báo cáo độ tin cậy, độ bao phủ và các trang cần kiểm tra',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </AuthRise>

          <p className="text-metadata text-text-muted">
            © {new Date().getFullYear()} DocAI. Chuyển đổi PDF sang DOCX theo Nghị định 30.
          </p>
        </div>

        {/* One compact 16px-radius panel holds the form. */}
        <main className="flex items-center justify-center px-4 py-12 sm:px-8">
          <AuthRise delay={0.08} className="w-full max-w-md">
            <div className="w-full rounded-panel border border-hairline bg-surface p-6 sm:p-8">
              <Link
                href="/"
                className="mb-6 inline-flex min-h-11 items-center gap-2 text-control font-medium text-text-secondary transition-colors hover:text-action lg:hidden"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Quay lại trang chủ
              </Link>
              {children}
            </div>
          </AuthRise>
        </main>
      </div>
    </RequireSession>
  );
}
