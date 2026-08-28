import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignupPage from '@/app/(auth)/signup/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ refresh: vi.fn(), user: null, status: 'anonymous' }),
}));
vi.mock('@/components/auth/TurnstileWidget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile">Xác minh</div>,
}));

afterEach(() => vi.unstubAllEnvs());

describe('signup registration mode', () => {
  it('renders an explicit unavailable state instead of a signup form', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DISABLE_PUBLIC_REGISTER', 'true');

    render(<SignupPage />);

    expect(screen.getByRole('heading', { name: 'Đăng ký chưa được mở' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tạo tài khoản' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute('href', '/login');
  });
});
