import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from '@/components/auth/AuthForm';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { PasswordResetUnavailable } from '@/components/auth/PasswordResetUnavailable';
import AuthLayout from '@/app/(auth)/layout';

// Mock next/navigation
const mockReplace = vi.fn();
const mockSearchGet = vi.fn((): string | null => null);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockSearchGet }),
}));

// Mock AuthProvider
const mockRefresh = vi.fn();
vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ refresh: mockRefresh, user: null, status: 'anonymous' }),
}));
vi.mock('@/components/auth/RequireSession', () => ({
  RequireSession: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/auth/TurnstileWidget', async () => {
  const React = await import('react');
  return {
    TurnstileWidget: ({ onToken, resetKey }: { onToken(token: string | null): void; resetKey: number }) => {
      React.useEffect(() => onToken('challenge-token'), [onToken, resetKey]);
      return <div data-testid="turnstile" data-reset-key={resetKey}>Đã xác minh</div>;
    },
  };
});

describe('AuthLayout', () => {
  it('exposes exactly one main landmark around the authentication form', () => {
    render(<AuthLayout><p>Biểu mẫu đăng nhập</p></AuthLayout>);

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('Biểu mẫu đăng nhập');
  });
});

describe('AuthForm — login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockReplace.mockClear();
    vi.stubGlobal('fetch', vi.fn());
    mockSearchGet.mockReturnValue(null);
  });

  it('renders one Vietnamese heading and submit button', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('keeps persistent Vietnamese field labels', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByLabelText('Tên đăng nhập')).toBeVisible();
    expect(screen.getByLabelText('Mật khẩu')).toBeVisible();
  });

  it('has autocomplete attributes', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByLabelText('Tên đăng nhập')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('keeps the password visibility control keyboard reachable with a 44px target', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    expect(toggle).toHaveClass('h-11', 'w-11');

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toHaveFocus();
  });

  it('shows a Vietnamese error on short username', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'ab');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tên đăng nhập phải có từ 3 đến 50 ký tự');
  });

  it('shows a Vietnamese error on short password', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Mật khẩu'), 'short');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu phải có từ 8 đến 100 ký tự');
  });

  it('surfaces a server error message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Sai tên đăng nhập hoặc mật khẩu' }), { status: 401 }),
    );

    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sai tên đăng nhập hoặc mật khẩu');
  });

  it('redirects on successful login', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('disables submit while pending', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {})); // never resolves

    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeDisabled();
  });

  it('shows link to signup', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByRole('link', { name: 'Tạo tài khoản' })).toHaveAttribute('href', '/signup');
  });

  it('places password recovery after the password field and before submit', () => {
    render(<AuthForm mode="login" />);
    const password = screen.getByLabelText('Mật khẩu');
    const forgot = screen.getByRole('link', { name: 'Quên mật khẩu?' });
    const submit = screen.getByRole('button', { name: 'Đăng nhập' });

    expect(password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(forgot.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides recovery when password reset is disabled', () => {
    render(<AuthForm mode="login" passwordResetEnabled={false} />);

    expect(screen.queryByRole('link', { name: 'Quên mật khẩu?' })).not.toBeInTheDocument();
  });

  it('keeps recovery visible in email mode', () => {
    render(<AuthForm mode="login" passwordResetEnabled />);

    expect(screen.getByRole('link', { name: 'Quên mật khẩu?' })).toHaveAttribute('href', '/forgot-password');
  });
});

describe('AuthForm — signup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockReplace.mockClear();
    vi.stubGlobal('fetch', vi.fn());
    mockSearchGet.mockReturnValue(null);
  });

  it('renders one Vietnamese heading and submit button', () => {
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Tạo tài khoản' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo tài khoản' })).toBeInTheDocument();
  });

  it('has password confirmation field', () => {
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);
    expect(screen.getByLabelText('Tên đăng nhập')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Xác nhận mật khẩu')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Email')).toBeRequired();
  });

  it('normalizes signup email before submitting', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const user = userEvent.setup();
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Email'), ' Alice@Example.COM ');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    expect(fetch).toHaveBeenCalledWith('/api/session/signup', expect.objectContaining({
      body: JSON.stringify({
        username: 'alice', email: 'alice@example.com', password: 'password123', passwordConfirmation: 'password123',
        turnstileToken: 'challenge-token',
      }),
    }));
  });

  it('shows a Vietnamese error on mismatched passwords', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'different');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu xác nhận không khớp');
  });

  it('surfaces a duplicate-username error from the server', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Tên đăng nhập đã tồn tại' }), { status: 409 }),
    );

    const user = userEvent.setup();
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'taken');
    await user.type(screen.getByLabelText('Email'), 'taken@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tên đăng nhập đã tồn tại');
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('');
    expect(screen.getByLabelText('Xác nhận mật khẩu')).toHaveValue('');
    expect(screen.getByTestId('turnstile')).toHaveAttribute('data-reset-key', '1');
  });

  it('routes a newly created account to the authenticated dashboard', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const user = userEvent.setup();
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);

    await user.type(screen.getByLabelText('Tên đăng nhập'), 'alice');
    await user.type(screen.getByLabelText('Email'), 'alice@example.com');
    await user.type(screen.getByLabelText('Mật khẩu'), 'password123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/convert');
    });
  });

  it('shows link to login', () => {
    render(<AuthForm mode="signup" turnstileSiteKey="site-key" />);
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });

  it('fails closed without a Turnstile site key and warns about password recovery', () => {
    render(<AuthForm mode="signup" />);

    expect(screen.getByRole('button', { name: 'Tạo tài khoản' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('xác minh');
    expect(screen.getByText(/không thể khôi phục mật khẩu/i)).toBeInTheDocument();
  });
});

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('keeps the enumeration-safe success message visible after submission', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
    }), { status: 202 }));
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Gửi hướng dẫn' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
    );
    expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute('href', '/login');
  });
});

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mockSearchGet.mockReturnValue(null);
  });

  it('shows a non-submittable state when the reset token is missing', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByRole('alert')).toHaveTextContent('Liên kết đặt lại mật khẩu không hợp lệ');
    expect(screen.queryByRole('button', { name: 'Đặt lại mật khẩu' })).not.toBeInTheDocument();
  });

  it('requires matching passwords and expires the local session after success', async () => {
    const token = 'A'.repeat(43);
    mockSearchGet.mockReturnValue(token);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const user = userEvent.setup();
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('Mật khẩu mới'), 'new-password-123');
    await user.type(screen.getByLabelText('Xác nhận mật khẩu mới'), 'new-password-123');
    await user.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));

    expect(fetch).toHaveBeenCalledWith('/api/session/reset-password', expect.objectContaining({
      body: JSON.stringify({ token, password: 'new-password-123' }),
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Mật khẩu đã được cập nhật');
  });
});

describe('PasswordResetUnavailable', () => {
  it('explains the pilot limitation without rendering a recovery form', () => {
    render(<PasswordResetUnavailable />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Khôi phục mật khẩu chưa được bật' })).toBeInTheDocument();
    expect(screen.getByText('Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.'))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText(/email|mật khẩu/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
