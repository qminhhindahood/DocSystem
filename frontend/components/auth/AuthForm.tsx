'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import { PasswordField } from './PasswordField';
import { normalizeClientReturnTo } from '@/lib/auth';
import { TurnstileWidget } from './TurnstileWidget';

interface AuthFormProps {
  mode: 'login' | 'signup';
  passwordResetEnabled?: boolean;
  turnstileSiteKey?: string;
}

export function AuthForm({ mode, passwordResetEnabled = true, turnstileSiteKey }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();

  const isLogin = mode === 'login';
  const heading = isLogin ? 'Đăng nhập' : 'Tạo tài khoản';
  const submitLabel = heading;

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  // Thresholds are unchanged; only the messages are localized.
  const validate = (): string | null => {
    if (username.length < 3 || username.length > 50) {
      return 'Tên đăng nhập phải có từ 3 đến 50 ký tự';
    }
    if (password.length < 8 || password.length > 100) {
      return 'Mật khẩu phải có từ 8 đến 100 ký tự';
    }
    if (!isLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Email không hợp lệ';
    }
    if (!isLogin && password !== passwordConfirmation) {
      return 'Mật khẩu xác nhận không khớp';
    }
    return null;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);

    try {
      const body = isLogin
        ? { username, password }
        : { username, email: email.trim().toLowerCase(), password, passwordConfirmation, turnstileToken };

      const res = await fetch(`/api/session/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Đã xảy ra lỗi. Vui lòng thử lại.');
        if (!isLogin) {
          setPassword('');
          setPasswordConfirmation('');
          setTurnstileToken(null);
          setTurnstileResetKey(value => value + 1);
        }
        return;
      }

      await auth.refresh();

      const returnTo = searchParams.get('returnTo');
      const target = isLogin
        ? normalizeClientReturnTo(returnTo)
        : '/dashboard';

      router.replace(target);
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setPending(false);
    }
  }

  function focusFirstInvalid(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const firstInvalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    firstInvalid?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        handleSubmit(e);
        focusFirstInvalid(e);
      }}
      noValidate
      className="space-y-5"
    >
      <div>
        <h1 className="text-page-title text-text-primary">{heading}</h1>
        <p className="mt-2 text-metadata text-text-secondary">
          {isLogin
            ? 'Nhập thông tin đăng nhập để tiếp tục.'
            : 'Tạo tài khoản để bắt đầu sử dụng DocAI.'}
        </p>
      </div>

      {error && <InlineAlert variant="error">{error}</InlineAlert>}

      <Input
        label="Tên đăng nhập"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        placeholder="ten-dang-nhap"
        disabled={pending}
        minLength={3}
        maxLength={50}
        required
      />

      {!isLogin && (
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="ten@donvi.gov.vn"
          disabled={pending}
          maxLength={254}
          required
        />
      )}

      <PasswordField
        label="Mật khẩu"
        value={password}
        onChange={setPassword}
        autoComplete={isLogin ? 'current-password' : 'new-password'}
        placeholder={isLogin ? 'Nhập mật khẩu' : 'Ít nhất 8 ký tự'}
        disabled={pending}
      />

      {isLogin && passwordResetEnabled && (
        <div className="text-right">
          <a href="/forgot-password" className="inline-flex min-h-11 items-center text-control font-medium text-action hover:underline">
            Quên mật khẩu?
          </a>
        </div>
      )}

      {!isLogin && (
        <>
          <PasswordField
            label="Xác nhận mật khẩu"
            value={passwordConfirmation}
            onChange={setPasswordConfirmation}
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu"
            disabled={pending}
          />
          <div className="rounded-control border border-warning/30 bg-warning/10 p-3 text-metadata text-text-secondary">
            Email chưa được xác minh và hiện không thể khôi phục mật khẩu. Hãy lưu mật khẩu ở nơi an toàn.
          </div>
          {turnstileSiteKey ? (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              action="signup"
              resetKey={turnstileResetKey}
              onToken={setTurnstileToken}
              onError={setError}
            />
          ) : (
            <InlineAlert variant="error">Không thể tải cấu hình xác minh. Vui lòng thử lại sau.</InlineAlert>
          )}
        </>
      )}

      <Button type="submit" size="lg" className="w-full" isLoading={pending} disabled={pending || (!isLogin && !turnstileToken)}>
        {submitLabel}
      </Button>

      <p className="text-center text-metadata text-text-secondary">
        {isLogin ? (
          <>
            Chưa có tài khoản?{' '}
            <a href="/signup" className="font-medium text-action hover:underline">
              Tạo tài khoản
            </a>
          </>
        ) : (
          <>
            Đã có tài khoản?{' '}
            <a href="/login" className="font-medium text-action hover:underline">
              Đăng nhập
            </a>
          </>
        )}
      </p>
    </form>
  );
}
