'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import type { FidelityValidationStatus } from '@/lib/api';

export interface ExportConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  validationStatus?: FidelityValidationStatus;
  pending: boolean;
  onConfirm: () => Promise<void>;
}

/**
 * States the known validation result without overstating it. `unavailable` is never
 * described as passed, and no compliance claim is made.
 */
const VALIDATION_COPY: Record<FidelityValidationStatus, { text: string; variant: 'success' | 'warning' | 'info' }> = {
  passed: {
    text: 'Kiểm tra bố cục đã đạt.',
    variant: 'success',
  },
  warnings: {
    text: 'Tệp có cảnh báo bố cục. Hãy mở tệp DOCX để kiểm tra trước khi phát hành.',
    variant: 'warning',
  },
  unavailable: {
    text: 'Chưa kiểm tra được bố cục. Hãy mở tệp DOCX để kiểm tra trước khi phát hành.',
    variant: 'info',
  },
};

export function ExportConfirmationDialog({
  open,
  onOpenChange,
  filename,
  validationStatus,
  pending,
  onConfirm,
}: ExportConfirmationDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  const validation = validationStatus ? VALIDATION_COPY[validationStatus] : null;

  // A fresh attempt should not inherit the previous failure.
  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleConfirm = async () => {
    if (pending) return;
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      setError('Không thể xuất tài liệu. Vui lòng thử lại.');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        <Dialog.Content
          aria-describedby="export-confirmation-description"
          className="fixed left-1/2 top-1/2 z-modal w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-panel border border-hairline bg-surface p-5 shadow-floating outline-none"
        >
          <Dialog.Title className="text-section-title text-text-primary">
            Xuất tài liệu
          </Dialog.Title>
          <Dialog.Description
            id="export-confirmation-description"
            className="mt-2 text-metadata text-text-secondary"
          >
            Tệp sẽ được tải về máy của bạn ở định dạng DOCX.
          </Dialog.Description>

          <dl className="mt-4 space-y-2 rounded-control border border-hairline bg-surface-subtle px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-metadata text-text-muted">Tên tệp</dt>
              <dd className="min-w-0 break-all text-right text-control text-text-primary">
                {filename}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-metadata text-text-muted">Định dạng</dt>
              <dd className="text-control text-text-primary">DOCX</dd>
            </div>
          </dl>

          {validation && (
            <div className="mt-3">
              <InlineAlert variant={validation.variant}>{validation.text}</InlineAlert>
            </div>
          )}

          {/* Persistent, not a transient toast: the dialog stays open on failure. */}
          {error && (
            <div className="mt-3">
              <InlineAlert variant="error">{error}</InlineAlert>
            </div>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" size="lg" disabled={pending}>
                Hủy
              </Button>
            </Dialog.Close>
            <Button size="lg" onClick={handleConfirm} disabled={pending} isLoading={pending}>
              Xuất DOCX
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
