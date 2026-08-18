'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TemplateStatus, TemplateSummary } from '@/lib/templates-api';
import { cn } from '@/components/lib/cn';
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  Loader2,
  Trash2,
  ChevronRight,
} from 'lucide-react';

interface TemplateStatusCardProps {
  template: TemplateSummary;
  selected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

const STATUS_CONFIG: Record<TemplateStatus, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default'; icon: React.ComponentType<{ className?: string }>; next?: string }> = {
  READY: { label: 'Sẵn sàng', variant: 'success', icon: CheckCircle, next: 'Có thể dùng khi tạo văn bản.' },
  NEEDS_REVIEW: { label: 'Cần xem lại', variant: 'warning', icon: AlertTriangle, next: 'Xem lại ánh xạ trường để hoàn tất.' },
  ANALYZING: { label: 'Đang phân tích', variant: 'info', icon: Loader2, next: 'Hệ thống đang xử lý mẫu này.' },
  UPLOADED: { label: 'Đã tải lên', variant: 'info', icon: Clock, next: 'Đang chờ phân tích.' },
  REJECTED: { label: 'Bị từ chối', variant: 'error', icon: XCircle, next: 'Sửa mẫu theo hướng dẫn rồi tải lên lại.' },
  FAILED: { label: 'Thất bại', variant: 'error', icon: XCircle, next: 'Hãy thử tải mẫu lên lại.' },
};

const REJECTION_LABELS: Record<string, string> = {
  FONT_RULE_VIOLATION: 'Phông chữ hoặc cỡ chữ chưa đúng quy định',
  UNSUPPORTED_DOCX_STRUCTURE: 'Mẫu có cấu trúc DOCX chưa được hỗ trợ',
  LEGACY_STATIC_RETIRED: 'Mẫu cũ chỉ được giữ lại để đối soát',
};

/**
 * One template row. A single 12px boundary holds the whole row: the review action
 * and the delete action are separate controls rather than nested inside a
 * clickable container.
 */
export function TemplateStatusCard({
  template,
  selected,
  onSelect,
  onDelete,
  deleting,
}: TemplateStatusCardProps) {
  const cfg = STATUS_CONFIG[template.status];
  const Icon = cfg.icon;
  const canDelete = onDelete && (template.status === 'REJECTED' || template.status === 'READY');

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-control border border-hairline bg-surface p-4',
        selected && 'ring-2 ring-focus',
        deleting && 'opacity-60',
      )}
      aria-busy={deleting || undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-body font-medium text-text-primary">
            {template.name}
          </h3>
          <Badge variant={cfg.variant} className="shrink-0">
            <Icon
              aria-hidden="true"
              className={cn('h-3 w-3', template.status === 'ANALYZING' && 'animate-spin')}
            />
            {cfg.label}
          </Badge>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-metadata text-text-muted">
          {template.docType && <span>{template.docType}</span>}
          {template.fileSize != null && (
            <span className="numeric">{(template.fileSize / 1024).toFixed(0)} KB</span>
          )}
          <span className="numeric">
            {new Date(template.createdAt).toLocaleDateString('vi-VN')}
          </span>
        </div>

        {cfg.next && (
          <p className="mt-1 text-metadata text-text-secondary">{cfg.next}</p>
        )}

        {/* Fidelity is only claimed once analysis has actually finished. */}
        {template.analysisConfidence != null && template.status === 'READY' && (
          <p className="mt-1 text-metadata text-success numeric">
            Độ tin cậy ánh xạ: {(template.analysisConfidence * 100).toFixed(0)}%
          </p>
        )}

        {template.rejectionCode && (
          <div className="mt-1.5 space-y-0.5">
            <p className="text-metadata font-medium text-error">
              {REJECTION_LABELS[template.rejectionCode] ?? template.rejectionCode}
            </p>
            {template.rejectionReason && (
              <p className="text-metadata text-text-secondary">{template.rejectionReason}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {template.status === 'NEEDS_REVIEW' && onSelect && (
          <button
            type="button"
            onClick={onSelect}
            disabled={deleting}
            className="inline-flex min-h-11 items-center gap-1 rounded-control px-3 text-control font-medium text-action transition-colors duration-fast hover:bg-action-tint disabled:opacity-50"
          >
            Xem lại ánh xạ
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="flex h-11 w-11 items-center justify-center rounded-compact text-text-muted transition-colors duration-fast hover:bg-surface-strong hover:text-error disabled:opacity-50"
            aria-label={`Xóa ${template.name}`}
          >
            {deleting ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
