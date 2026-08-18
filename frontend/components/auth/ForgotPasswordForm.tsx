'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';

const SAFE_MESSAGE = 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Email không hợp lệ');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/session/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      if (!response.ok) {
        setError('Không thể gửi yêu cầu lúc này. Vui lòng thử lại.');
        return;
      }
      setSent(true);
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div>
        <h1 className="text-page-title text-text-primary">Quên mật khẩu</h1>
        <p className="mt-2 text-metadata text-text-secondary">
          Nhập email tài khoản. Nếu tài khoản tồn tại, bạn sẽ nhận được liên kết dùng một lần.
        </p>
      </div>
      {sent && <InlineAlert variant="success">{SAFE_MESSAGE}</InlineAlert>}
      {error && <InlineAlert variant="error">{error}</InlineAlert>}
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="ten@donvi.gov.vn"
        disabled={pending || sent}
        required
      />
      <Button type="submit" size="lg" className="w-full" isLoading={pending} disabled={sent}>
        Gửi hướng dẫn
      </Button>
      <p className="text-center text-metadata text-text-secondary">
        <a href="/login" className="inline-flex min-h-11 items-center font-medium text-action hover:underline">
          Quay lại đăng nhập
        </a>
      </p>
    </form>
  );
}
