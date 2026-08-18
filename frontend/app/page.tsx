'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  ChevronRight,
  FileCheck2,
  FileSearch,
  FileText,
  ArrowRight,
  Plus,
  Minus,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';

const ACCORDION_ITEMS = [
  {
    title: 'Tải lên & trích xuất',
    desc: 'Tải lên PDF, DOCX hoặc văn bản tham chiếu. Hệ thống trích xuất cấu trúc Điều / Khoản / Điểm và lưu trữ để tìm kiếm ngữ nghĩa.',
  },
  {
    title: 'Tạo dự thảo',
    desc: 'Từ yêu cầu nghiệp vụ, hệ thống tạo dự thảo hai giai đoạn — trước Outline, sau Nội dung — để từng Điều đều có căn cứ pháp lý rõ ràng.',
  },
  {
    title: 'Tuân thủ thể thức',
    desc: 'Quốc hiệu, tiêu ngữ, căn cứ pháp lý và bố cục điều khoản được kiểm tra tự động; kết quả kiểm tra hiển thị trước khi bạn xuất tài liệu.',
  },
  {
    title: 'Mẫu DOCX',
    desc: 'Tải lên mẫu DOCX của cơ quan. Hệ thống nhận diện vùng dữ liệu và áp dụng khi xuất, giữ đúng kiểu đoạn và vùng ký.',
  },
  {
    title: 'Xuất văn bản',
    desc: 'Xuất tệp DOCX hoàn chỉnh sau khi xác nhận, kèm trạng thái kiểm tra bố cục đã biết.',
  },
];

// The three workflow stages the product actually implements.
const WORKFLOW_STAGES = [
  {
    icon: FileSearch,
    title: 'Nguồn tham chiếu',
    caption: 'Trích xuất & lưu trữ',
    desc: 'Tài liệu tham chiếu được tách theo Điều, Khoản, Điểm rồi lập chỉ mục để tra cứu theo ngữ nghĩa.',
  },
  {
    icon: FileText,
    title: 'Văn bản hoàn chỉnh',
    caption: 'Tạo dự thảo có căn cứ',
    desc: 'Dự thảo được tạo hai giai đoạn: dựng outline trước, sau đó điền nội dung chi tiết theo từng điều khoản.',
  },
  {
    icon: FileCheck2,
    title: 'Kiểm tra thể thức',
    caption: 'Theo Nghị định 30/2020/NĐ-CP',
    desc: 'Các thành phần bắt buộc và bố cục được kiểm tra, kết quả hiển thị rõ trước khi phát hành.',
  },
];

export default function LandingPage() {
  const { status } = useAuth();
  const { theme, toggle } = useTheme();
  const isLoggedIn = status === 'authenticated';
  const [openAcc, setOpenAcc] = useState<number | null>(null);

  const toggleAcc = useCallback(
    (i: number) => setOpenAcc((prev) => (prev === i ? null : i)),
    [],
  );

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <header className="sticky top-0 z-sticky flex h-[52px] items-center border-b border-hairline bg-surface">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Link href={isLoggedIn ? '/dashboard' : '/'} aria-label="DocAI">
            <span className="text-section-title">DocAI</span>
          </Link>

          <nav aria-label="Điều hướng công khai" className="hidden items-center gap-6 md:flex">
            {[
              { label: 'Quy trình', href: '#workflow' },
              { label: 'Khả năng', href: '#services' },
              { label: 'Liên hệ', href: '#footer' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-control text-text-secondary transition-colors hover:text-text-primary"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              variant="icon"
              size="sm"
              onClick={toggle}
              aria-label="Chuyển giao diện"
              className="flex items-center justify-center"
            >
              {theme === 'dark' ? (
                <Sun aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Moon aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>

            <Link
              href={isLoggedIn ? '/dashboard' : '/login'}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-4 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
            >
              {isLoggedIn ? 'Vào không gian làm việc' : 'Đăng nhập'}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Editorial but product-grounded hero. */}
        <section className="px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Văn bản hành chính, từ nguồn đến bản hoàn chỉnh
            </h1>
            <p className="mx-auto mt-6 max-w-[60ch] text-body text-text-secondary">
              Cung cấp tài liệu tham chiếu và yêu cầu nghiệp vụ. DocAI tạo dự thảo có căn cứ
              pháp lý, giữ chuẩn mẫu DOCX và hiển thị rõ từng kết quả kiểm tra trước khi bạn
              phát hành.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={isLoggedIn ? '/generate' : '/login'}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-6 py-3 text-body font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
              >
                {isLoggedIn ? 'Bắt đầu soạn thảo' : 'Đăng nhập để soạn thảo'}
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              {/* Borderless secondary learning link. */}
              <Link
                href="#workflow"
                className="inline-flex min-h-11 items-center gap-2 px-2 text-body font-medium text-action transition-opacity hover:opacity-80"
              >
                Khám phá quy trình
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* Real workflow proof: what the product does, not invented metrics. */}
        <section id="workflow" className="border-t border-hairline px-4 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto max-w-[1120px]">
            <h2 className="text-page-title">Quy trình soạn thảo</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {WORKFLOW_STAGES.map(({ icon: Icon, title, caption, desc }) => (
                <div
                  key={title}
                  className="rounded-panel border border-hairline bg-surface p-5"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-control bg-action-tint text-action">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-section-title">{title}</h3>
                  <p className="mt-1 text-metadata text-text-muted">{caption}</p>
                  <p className="mt-3 text-body text-text-secondary">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Capabilities accordion. */}
        <section id="services" className="border-t border-hairline px-4 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto grid max-w-[1120px] gap-8 lg:grid-cols-[0.35fr_0.65fr]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h2 className="text-page-title">Khả năng cốt lõi</h2>
              <Link
                href={isLoggedIn ? '/generate' : '/login'}
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-control font-semibold text-action transition-opacity hover:opacity-80"
              >
                {isLoggedIn ? 'Bắt đầu ngay' : 'Đăng nhập'}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="divide-y divide-hairline">
              {ACCORDION_ITEMS.map((item, i) => {
                const isOpen = openAcc === i;
                return (
                  <div key={item.title} className="py-2">
                    <button
                      onClick={() => toggleAcc(i)}
                      className="flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="text-section-title text-text-primary">{item.title}</span>
                      <span
                        aria-hidden="true"
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-control border border-hairline text-text-muted"
                      >
                        {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </button>
                    {isOpen && (
                      <p className="max-w-[60ch] pb-4 text-body text-text-secondary">
                        {item.desc}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-hairline px-4 py-16 text-center sm:px-6 lg:py-20">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-page-title">
              Tập trung vào quyết định. Để hệ thống lo phần trình bày.
            </h2>
            <p className="mx-auto mt-4 max-w-[60ch] text-body text-text-secondary">
              Bắt đầu từ nguồn tài liệu của bạn và tạo một bản thảo có thể kiểm tra, chỉnh sửa
              và xuất ngay trong cùng quy trình.
            </p>
            <Link
              href={isLoggedIn ? '/generate' : '/login'}
              className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-6 py-3 text-body font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
            >
              {isLoggedIn ? 'Tạo văn bản' : 'Đăng nhập'}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer id="footer" className="border-t border-hairline px-4 py-12 sm:px-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-metadata text-text-muted">Liên hệ</p>
            <Link
              href="mailto:hello@docai.vn"
              className="text-body text-text-primary transition-colors hover:text-action"
            >
              hello@docai.vn
            </Link>
          </div>
          <p className="text-metadata text-text-muted">
            © {new Date().getFullYear()} DocAI. Hệ thống hỗ trợ soạn thảo văn bản hành chính.
          </p>
        </div>
      </footer>
    </div>
  );
}
