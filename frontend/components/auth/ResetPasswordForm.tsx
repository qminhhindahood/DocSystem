'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import { PasswordField } from './PasswordField';

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8 || password.length > 100) {
      setError('Mật khẩu phải có từ 8 đến 100 ký tự');
      return;
    }
    if (password !== confirmation) {
      setError('Mật khẩu xác nhận không khớp');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/session/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        setError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  if (!validToken) {
    return (
      <div className="space-y-5">
        <h1 className="text-page-title text-text-primary">Đặt lại mật khẩu</h1>
        <InlineAlert variant="error">Liên kết đặt lại mật khẩu không hợp lệ.</InlineAlert>
        <a href="/forgot-password" className="inline-flex min-h-11 items-center text-control font-medium text-action hover:underline">
          Yêu cầu liên kết mới
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h1 className="text-page-title text-text-primary">Đặt lại mật khẩu</h1>
        <p className="mt-2 text-metadata text-text-secondary">Chọn mật khẩu mới cho tài khoản DocAI.</p>
      </div>
      {success && (
        <InlineAlert variant="success" action={<a href="/login" className="font-medium text-action hover:underline">Đăng nhập</a>}>
          Mật khẩu đã được cập nhật. Các phiên đăng nhập cũ đã hết hiệu lực.
        </InlineAlert>
      )}
      {error && <InlineAlert variant="error">{error}</InlineAlert>}
      {!success && (
        <>
          <PasswordField label="Mật khẩu mới" value={password} onChange={setPassword} autoComplete="new-password" disabled={pending} />
          <PasswordField label="Xác nhận mật khẩu mới" value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={pending} />
          <Button type="submit" size="lg" className="w-full" isLoading={pending}>Đặt lại mật khẩu</Button>
        </>
      )}
    </form>
  );
}
