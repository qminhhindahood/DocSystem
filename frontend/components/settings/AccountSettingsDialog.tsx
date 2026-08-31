'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { UserRound, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DELETE_CONFIRMATION = 'XÓA TÀI KHOẢN';

export function AccountSettingsDialog() {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPassword('');
    setConfirmation('');
    setError(null);
    setSubmitting(false);
  };

  const onOpenChange = (next: boolean) => {
    if (submitting) return;
    setOpen(next);
    if (!next) reset();
  };

  const deleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || confirmation !== DELETE_CONFIRMATION || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/session/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setError(response.status === 401
          ? 'Mật khẩu không đúng.'
          : body.error || 'Không thể xóa tài khoản. Vui lòng thử lại.');
        return;
      }
      setOpen(false);
      reset();
      await refresh();
    } catch {
      setError('Không thể xóa tài khoản. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-control text-text-secondary transition-colors duration-fast hover:bg-surface-strong hover:text-text-primary"
        >
          <UserRound className="h-5 w-5 flex-shrink-0" />
          <span className="truncate">Quản lý tài khoản</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/55" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-modal w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-panel bg-surface-strong p-5 shadow-floating outline-none sm:p-6"
          aria-describedby="delete-account-description"
        >
          <Dialog.Title className="pr-12 text-section-title text-text-primary">
            Xóa tài khoản
          </Dialog.Title>
          <Dialog.Description
            id="delete-account-description"
            className="mt-2 text-control text-text-muted"
          >
            Thao tác này xóa vĩnh viễn tài khoản và cấu hình khóa API đã mã hóa. Bản sao lưu mã hóa sẽ hết hạn trong vòng 30 ngày.
          </Dialog.Description>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Đóng quản lý tài khoản"
              className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-compact text-text-muted hover:bg-surface-strong hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
          <form className="mt-5 space-y-4" onSubmit={deleteAccount}>
            <Input
              type="password"
              autoComplete="current-password"
              label="Mật khẩu hiện tại"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Input
              type="text"
              autoComplete="off"
              label="Nhập “XÓA TÀI KHOẢN” để xác nhận"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
            {error && (
              <p role="alert" className="rounded-control bg-error-surface px-3 py-2 text-body text-error">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={submitting}>Hủy</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="destructive"
                isLoading={submitting}
                disabled={!password || confirmation !== DELETE_CONFIRMATION}
              >
                Xóa tài khoản vĩnh viễn
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
