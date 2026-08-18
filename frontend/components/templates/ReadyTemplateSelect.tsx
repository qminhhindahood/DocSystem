'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { TemplateSummary } from '@/lib/templates-api';

interface ReadyTemplateSelectProps {
  templates: TemplateSummary[];
  value: string;
  onValueChange: (value: string) => void;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void | Promise<unknown>;
}

export function ReadyTemplateSelect({
  templates,
  value,
  onValueChange,
  isLoading,
  error,
  onRetry,
}: ReadyTemplateSelectProps) {
  const readyTemplates = templates.filter(template => template.status === 'READY');

  return (
    <div>
      <h2 className="mb-2 text-metadata font-semibold text-text-primary">
        Mẫu DOCX của bạn
      </h2>
      <Select
        value={value}
        onValueChange={onValueChange}
        options={readyTemplates.map(template => ({ value: template.id, label: template.name }))}
        placeholder={isLoading ? 'Đang tải mẫu DOCX…' : 'Chọn mẫu DOCX'}
        disabled={isLoading || Boolean(error) || readyTemplates.length === 0}
        className="w-full"
      />

      {error && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1" role="alert">
          <p className="text-metadata text-error">{error.message || 'Không thể tải mẫu DOCX'}</p>
          <Button type="button" variant="link" size="sm" onClick={() => void onRetry()}>
            Thử lại
          </Button>
        </div>
      )}

      {!isLoading && !error && readyTemplates.length === 0 && (
        <p className="mt-2 text-metadata text-warning">
          Chưa có mẫu DOCX sẵn sàng.{' '}
          <Link className="font-medium text-action underline underline-offset-2" href="/templates">
            Đến trang Mẫu văn bản
          </Link>
        </p>
      )}
    </div>
  );
}
