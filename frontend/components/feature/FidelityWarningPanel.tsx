"use client";

import { AlertTriangle, CheckCircle2, EyeOff } from 'lucide-react';
import type { FidelitySummary, FidelityWarning } from '@/lib/api';

interface FidelityWarningPanelProps {
  fidelity: FidelitySummary;
}

const headingByStatus = {
  passed: 'Kiểm tra bố cục đã đạt',
  warnings: 'Đã tạo với cảnh báo bố cục',
  unavailable: 'Đã tạo; không thể kiểm tra hình ảnh',
} as const;

function warningText(warning: FidelityWarning): string {
  const details = warning.details ?? {};
  switch (warning.code) {
    case 'FONT_SUBSTITUTED':
      return details.requested && details.resolved
        ? `Phông ${details.requested} được thay bằng ${details.resolved}.`
        : 'Một phông chữ trong mẫu đã được thay bằng phông tương thích.';
    case 'PAGE_COUNT_CHANGED':
      return details.baseline && details.generated
        ? `Số trang thay đổi từ ${details.baseline} trang thành ${details.generated} trang.`
        : 'Số trang của tệp tạo ra khác với mẫu ban đầu.';
    case 'PAGE_DIMENSIONS_CHANGED':
      return details.page
        ? `Kích thước trang ${details.page} khác với mẫu ban đầu.`
        : 'Kích thước của một hoặc nhiều trang đã thay đổi.';
    case 'POSSIBLE_OVERFLOW':
      return 'Nội dung có thể dài hơn vùng bố cục dự kiến; hãy kiểm tra ngắt trang và hộp văn bản.';
    case 'SHORTENING_FAILED':
      return 'Không thể rút gọn tự động; phiên bản hợp lệ đầu tiên đã được giữ lại.';
    case 'FONT_VALIDATION_UNAVAILABLE':
      return 'Không thể xác minh đầy đủ phông chữ trên hệ thống dựng tài liệu.';
    case 'RENDER_TIMEOUT':
    case 'RENDER_VALIDATION_UNAVAILABLE':
    case 'LIBREOFFICE_TIMEOUT':
    case 'POPPLER_TIMEOUT':
      return 'Không thể hoàn tất kiểm tra hình ảnh. Hãy mở tệp DOCX để kiểm tra bố cục trước khi phát hành.';
    default:
      return warning.message;
  }
}

export function FidelityWarningPanel({ fidelity }: FidelityWarningPanelProps) {
  const unavailable = fidelity.validationStatus === 'unavailable';
  const hasHighWarning = fidelity.warnings.some(warning => warning.severity === 'high');
  const role = unavailable || hasHighWarning ? 'alert' : 'status';
  const Icon = fidelity.validationStatus === 'passed'
    ? CheckCircle2
    : unavailable ? EyeOff : AlertTriangle;
  const color = fidelity.validationStatus === 'passed'
    ? 'text-success'
    : fidelity.validationStatus === 'warnings' ? 'text-warning' : 'text-text-muted';
  const headingId = `fidelity-${fidelity.validationStatus}-heading`;

  return (
    <section
      role={role}
      aria-labelledby={headingId}
      className="rounded-control border border-hairline bg-surface-strong px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} aria-hidden="true" />
        <div className="min-w-0">
          <h3 id={headingId} className="text-control font-semibold text-text-primary">
            {headingByStatus[fidelity.validationStatus]}
          </h3>
          {fidelity.validationStatus === 'passed' ? (
            <p className="mt-1 text-control text-text-muted">
              Bản xem trước tự động không phát hiện thay đổi về số trang hoặc kích thước trang.
            </p>
          ) : (
            <>
              {unavailable && (
                <p className="mt-1 text-control text-text-muted">
                  Tệp DOCX đã được kiểm tra cấu trúc. Hãy mở tệp DOCX để kiểm tra bố cục trước khi phát hành.
                </p>
              )}
              {fidelity.warnings.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-control text-text-muted">
                  {fidelity.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${warning.field ?? ''}-${index}`} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span>{warningText(warning)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
