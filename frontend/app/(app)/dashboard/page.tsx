import Link from 'next/link';
import { ChevronRight, FilePlus2, FileSearch, LayoutTemplate, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';

const supportingActions = [
  {
    href: '/documents',
    label: 'Tìm trong tài liệu',
    description: 'Lọc, mở và xuất lại văn bản đã tạo.',
    icon: FileSearch,
  },
  {
    href: '/qa',
    label: 'Hỏi theo nguồn',
    description: 'Nhận câu trả lời kèm đoạn trích dẫn từ tài liệu.',
    icon: MessageSquare,
  },
  {
    href: '/templates',
    label: 'Quản lý mẫu',
    description: 'Kiểm tra vùng dữ liệu và độ tương thích mẫu DOCX.',
    icon: LayoutTemplate,
  },
];

export default function Dashboard() {
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Bạn muốn bắt đầu từ đâu?"
        description="Tạo bản thảo mới, tìm lại tài liệu hoặc kiểm tra căn cứ mà không rời khỏi không gian làm việc."
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        {/* One dominant entry point into the primary workflow. */}
        <Link
          href="/generate"
          className="group flex flex-col justify-between gap-8 rounded-panel border border-hairline bg-surface p-6 transition-colors duration-fast hover:bg-surface-subtle sm:p-8"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-control bg-action text-on-action">
            <FilePlus2 aria-hidden="true" className="h-6 w-6" />
          </span>
          <span className="max-w-xl">
            <span className="block text-section-title text-text-primary">Tạo tài liệu</span>
            <span className="mt-2 block text-body text-text-secondary">
              Chọn loại văn bản, thêm nguồn tham chiếu và tạo dự thảo theo mẫu DOCX của cơ quan bạn.
            </span>
            <span className="mt-5 inline-flex min-h-11 items-center gap-1 text-control font-semibold text-action group-hover:underline">
              Mở bàn soạn thảo
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </span>
          </span>
        </Link>

        {/* Compact supporting rows; one boundary holds the group. */}
        <div className="divide-y divide-hairline overflow-hidden rounded-panel border border-hairline bg-surface">
          {supportingActions.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-3 p-4 transition-colors duration-fast hover:bg-surface-subtle"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-surface-strong text-action">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3 text-control font-semibold text-text-primary">
                  {label}
                  <ChevronRight
                    aria-hidden="true"
                    className="h-4 w-4 flex-none text-text-muted group-hover:text-action"
                  />
                </span>
                <span className="mt-1 block text-metadata text-text-secondary">
                  {description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <p className="border-t border-hairline pt-4 text-metadata text-text-muted">
        Quy trình: nguồn tham chiếu → mẫu DOCX → dự thảo → kiểm tra thể thức theo Nghị định 30/2020/NĐ-CP.
      </p>
    </div>
  );
}
