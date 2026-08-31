'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronRight,
  FileCheck2,
  FileSearch,
  FileOutput,
  ArrowRight,
  Plus,
  Minus,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/landing/Reveal';
import { HeroDocument } from '@/components/landing/HeroDocument';
import { PolicyLinks } from '@/components/legal/PolicyLinks';
import {
  fadeRiseDelayed,
  maskLine,
  staggerContainer,
  springSnappy,
} from '@/lib/motion';

const ACCORDION_ITEMS = [
  {
    title: 'Tải lên PDF',
    desc: 'Tải lên tệp PDF scan hoặc bản số. Hệ thống nhận diện từng trang và phân loại trang văn bản, trang bảng biểu, trang ảnh.',
  },
  {
    title: 'Chuyển đổi sang Word',
    desc: 'Nội dung được chuyển thành văn bản Word (.docx) giữ cấu trúc đoạn, bảng và thứ tự trang của bản gốc.',
  },
  {
    title: 'Chuẩn thể thức Nghị định 30',
    desc: 'Phông chữ, cỡ chữ và bố cục được áp theo Nghị định 30/2020/NĐ-CP để văn bản dùng được ngay cho công việc hành chính.',
  },
  {
    title: 'Độ tin cậy rõ ràng',
    desc: 'Mỗi trang được chấm điểm độ tin cậy. Trang nhận diện kém được đánh dấu để bạn kiểm tra lại, không bao giờ im lặng bỏ qua.',
  },
  {
    title: 'Tải xuống DOCX',
    desc: 'Kết quả là tệp DOCX hoàn chỉnh, tải về và chỉnh sửa tiếp trong Word.',
  },
];

// The three stages the conversion product actually implements.
const WORKFLOW_STAGES = [
  {
    icon: FileSearch,
    title: 'Tải lên & phân loại',
    caption: 'PDF scan hoặc bản số',
    desc: 'Tệp PDF được phân tích từng trang: trang văn bản, bảng biểu hay ảnh, để chọn cách xử lý phù hợp.',
  },
  {
    icon: FileOutput,
    title: 'Chuyển đổi DOCX',
    caption: 'Giữ cấu trúc bản gốc',
    desc: 'Nội dung được dựng lại thành văn bản Word với đoạn, bảng và thứ tự trang theo đúng bản gốc.',
  },
  {
    icon: FileCheck2,
    title: 'Kiểm tra độ tin cậy',
    caption: 'Theo Nghị định 30/2020/NĐ-CP',
    desc: 'Kết quả được chấm điểm theo từng trang; trang nghi ngờ được đánh dấu rõ để bạn rà soát trước khi dùng.',
  },
];

const MASK_PAD = '-my-[0.08em] overflow-hidden py-[0.08em]';

export default function LandingPage() {
  const { status } = useAuth();
  const { theme, toggle } = useTheme();
  const isLoggedIn = status === 'authenticated';
  const [openAcc, setOpenAcc] = useState<number | null>(0);

  const toggleAcc = useCallback(
    (i: number) => setOpenAcc((prev) => (prev === i ? null : i)),
    [],
  );

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <header className="sticky top-0 z-sticky flex h-[52px] items-center border-b border-hairline bg-surface">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
          <Link href={isLoggedIn ? '/convert' : '/'} aria-label="DocAI">
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
                className="text-control text-text-secondary transition-colors duration-fast hover:text-text-primary"
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
              href={isLoggedIn ? '/convert' : '/login'}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-4 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
            >
              {isLoggedIn ? 'Vào không gian làm việc' : 'Đăng nhập'}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Signature hero: masked headline assembly + miniature conversion story. */}
        <section className="overflow-hidden px-4 pb-16 pt-12 sm:px-6 lg:pb-24 lg:pt-20">
          <div className="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="text-center lg:text-left"
            >
              <h1 className="text-display-hero">
                <span className={`block ${MASK_PAD}`}>
                  <motion.span className="block" variants={maskLine}>
                    PDF sang Word,{' '}
                  </motion.span>
                </span>
                <span className={`block ${MASK_PAD}`}>
                  <motion.span className="block" variants={maskLine}>
                    chuẩn Nghị định 30
                  </motion.span>
                </span>
              </h1>

              <motion.p
                variants={fadeRiseDelayed}
                custom={0.4}
                className="mx-auto mt-6 max-w-[56ch] text-body text-text-secondary lg:mx-0"
              >
                Tải lên tệp PDF scan hoặc bản số. DocAI chuyển thành văn bản Word giữ đúng cấu
                trúc, áp thể thức Nghị định 30/2020/NĐ-CP và đánh dấu rõ những trang cần kiểm tra.
              </motion.p>

              <motion.div
                variants={fadeRiseDelayed}
                custom={0.52}
                className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
              >
                <Link
                  href={isLoggedIn ? '/convert' : '/login'}
                  className="group inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-6 py-3 text-body font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
                >
                  {isLoggedIn ? 'Bắt đầu chuyển đổi' : 'Đăng nhập để chuyển đổi'}
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform duration-fast ease-spring group-hover:translate-x-0.5"
                  />
                </Link>
                {/* Borderless secondary learning link. */}
                <Link
                  href="#workflow"
                  className="inline-flex min-h-11 items-center gap-2 px-2 text-body font-medium text-action transition-opacity duration-fast hover:opacity-80"
                >
                  Khám phá quy trình
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </motion.div>
            </motion.div>

            <HeroDocument />
          </div>
        </section>

        {/* Real workflow proof: what the product does, not invented metrics. */}
        <section
          id="workflow"
          className="scroll-mt-[72px] border-t border-hairline px-4 py-16 sm:px-6 lg:py-24"
        >
          <div className="mx-auto max-w-[1120px]">
            <Reveal>
              <h2 className="text-display-lg">Quy trình chuyển đổi</h2>
              <p className="mt-3 max-w-[60ch] text-body text-text-secondary">
                Từ tệp PDF gốc đến bản Word đã kiểm chứng độ tin cậy, trong ba bước.
              </p>
            </Reveal>

            <ol className="relative mt-10 grid gap-4 md:grid-cols-3">
              {/* Connecting rail draws itself behind the step numbers. */}
              <motion.div
                aria-hidden="true"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.9, delay: 0.25, ease: [0.05, 0.7, 0.1, 1] }}
                className="absolute left-10 right-10 top-5 hidden h-px origin-left bg-hairline md:block"
              />
              {WORKFLOW_STAGES.map(({ icon: Icon, title, caption, desc }, i) => (
                <li key={title}>
                  <Reveal delay={i * 0.12} className="h-full">
                    <div className="h-full rounded-panel border border-hairline bg-surface p-5 transition-shadow duration-standard hover:shadow-floating">
                      <div className="flex items-center justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-control bg-action-tint text-action">
                          <Icon aria-hidden="true" className="h-5 w-5" />
                        </span>
                        <span className="numeric text-metadata font-semibold text-text-muted">
                          0{i + 1}
                        </span>
                      </div>
                      <h3 className="mt-4 text-section-title">{title}</h3>
                      <p className="mt-1 text-metadata text-text-muted">{caption}</p>
                      <p className="mt-3 text-body text-text-secondary">{desc}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Capabilities accordion with spring choreography. */}
        <section
          id="services"
          className="scroll-mt-[72px] border-t border-hairline px-4 py-16 sm:px-6 lg:py-24"
        >
          <div className="mx-auto grid max-w-[1120px] gap-8 lg:grid-cols-[0.35fr_0.65fr]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Reveal>
                <h2 className="text-display-lg">Khả năng cốt lõi</h2>
                <Link
                  href={isLoggedIn ? '/convert' : '/login'}
                  className="group mt-4 inline-flex min-h-11 items-center gap-2 text-control font-semibold text-action transition-opacity duration-fast hover:opacity-80"
                >
                  {isLoggedIn ? 'Bắt đầu ngay' : 'Đăng nhập'}
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform duration-fast ease-spring group-hover:translate-x-0.5"
                  />
                </Link>
              </Reveal>
            </div>

            <Reveal delay={0.08}>
              <div className="divide-y divide-hairline">
                {ACCORDION_ITEMS.map((item, i) => {
                  const isOpen = openAcc === i;
                  return (
                    <div key={item.title} className="py-2">
                      <button
                        onClick={() => toggleAcc(i)}
                        className="group flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left"
                        aria-expanded={isOpen}
                      >
                        <span className="flex items-baseline gap-3">
                          <span className="numeric text-metadata font-semibold text-text-muted">
                            0{i + 1}
                          </span>
                          <span className="text-section-title text-text-primary transition-colors duration-fast group-hover:text-action">
                            {item.title}
                          </span>
                        </span>
                        <motion.span
                          aria-hidden="true"
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={springSnappy}
                          className="flex h-8 w-8 flex-none items-center justify-center rounded-control border border-hairline text-text-muted"
                        >
                          {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="content"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.05, 0.7, 0.1, 1] }}
                            className="overflow-hidden"
                          >
                            <p className="max-w-[60ch] pb-4 pl-8 pt-1 text-body text-text-secondary">
                              {item.desc}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-t border-hairline px-4 py-16 text-center sm:px-6 lg:py-24">
          <Reveal>
            <div className="mx-auto max-w-2xl">
              <h2 className="text-display-md sm:text-display-lg">
                Bản Word dùng được ngay. Độ tin cậy nhìn thấy rõ.
              </h2>
              <p className="mx-auto mt-4 max-w-[60ch] text-body text-text-secondary">
                Tải lên tệp PDF của bạn và nhận về văn bản Word chuẩn thể thức, kèm báo cáo độ
                tin cậy từng trang để bạn yên tâm sử dụng.
              </p>
              <Link
                href={isLoggedIn ? '/convert' : '/login'}
                className="group mt-8 inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-6 py-3 text-body font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
              >
                {isLoggedIn ? 'Chuyển đổi ngay' : 'Đăng nhập'}
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-fast ease-spring group-hover:translate-x-0.5"
                />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer id="footer" className="border-t border-hairline px-4 py-12 sm:px-6">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-metadata text-text-muted">Liên hệ</p>
            <Link href="/data-handling" className="text-body text-text-primary transition-colors duration-fast hover:text-action">Thông tin hỗ trợ và xử lý dữ liệu</Link>
            <PolicyLinks className="mt-3 flex flex-wrap gap-4 text-metadata text-text-muted" />
          </div>
          <p className="text-metadata text-text-muted">
            © {new Date().getFullYear()} DocAI. Chuyển đổi PDF sang Word chuẩn Nghị định 30/2020/NĐ-CP.
          </p>
        </div>
      </footer>
    </div>
  );
}
