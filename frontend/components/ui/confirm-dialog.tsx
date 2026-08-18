'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/lib/cn';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
}

/**
 * Confirmation for an action the user cannot undo. Closes only after the callback
 * resolves; a rejection keeps the dialog open so the caller can surface the error.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Hủy',
  destructive,
  pending,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [confirming, setConfirming] = React.useState(false);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const busy = pending || confirming;

  const handleConfirm = async () => {
    if (busy) return;
    setConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Keep the dialog open; the caller reports the failure in place.
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={cn(
            'fixed left-1/2 top-1/2 z-modal w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-panel border border-hairline bg-surface p-5 shadow-floating outline-none',
          )}
        >
          <Dialog.Title id={titleId} className="text-section-title text-text-primary">
            {title}
          </Dialog.Title>
          <Dialog.Description
            id={descriptionId}
            className="mt-2 text-metadata text-text-secondary"
          >
            {description}
          </Dialog.Description>

          {children && <div className="mt-4">{children}</div>}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" size="lg" disabled={busy}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              size="lg"
              onClick={handleConfirm}
              disabled={busy}
              isLoading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
