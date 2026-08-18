import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from '@testing-library/user-event';
import { AppShell } from "@/components/layout/AppShell";
import Loading from "@/app/loading";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock lucide-react icons — covers all icons used by AppShell, Sidebar, Header, Toast.
// Real lucide icons render aria-hidden SVGs, so the stubs must be hidden too or they
// would leak into every accessible name.
vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const Stub = () => (
      <span aria-hidden="true" data-testid={`${name}-icon`}>
        {name}
      </span>
    );
    Stub.displayName = `${name}Icon`;
    return Stub;
  };

  return {
    Menu: icon('menu'),
    Moon: icon('moon'),
    Sun: icon('sun'),
    Bell: icon('bell'),
    User: icon('user'),
    LogOut: icon('logout'),
    FileText: icon('file-text'),
    FileSearch: icon('file-search'),
    FileOutput: icon('file-output'),
    X: icon('x'),
    XCircle: icon('x-circle'),
    CheckCircle: icon('check-circle'),
    AlertTriangle: icon('alert-triangle'),
    AlertCircle: icon('alert-circle'),
    MessageSquare: icon('message-square'),
    Settings: icon('settings'),
    FolderOpen: icon('folder'),
    LayoutTemplate: icon('template'),
    Info: icon('info'),
    Loader2: icon('loader'),
    RotateCcw: icon('rotate'),
    LayoutGrid: icon('grid'),
  };
});

// Mock useTheme
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

vi.mock("@/components/settings/LLMSettingsDialog", () => ({
  LLMSettingsDialog: () => <button>Cài đặt LLM</button>,
}));

const logout = vi.fn();
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ status: 'authenticated', user: null, logout, refresh: vi.fn() }),
}));

describe("AppShell", () => {
  it("renders children", () => {
    render(
      <AppShell>
        <p>Hello World</p>
      </AppShell>,
    );
    expect(screen.getByText("Hello World")).toBeDefined();
  });

  it("renders sidebar with localized navigation links", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /Tạo văn bản/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Tài liệu/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Mẫu văn bản/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Tra cứu/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cài đặt LLM' })).toBeDefined();
  });

  it("uses a 256px desktop sidebar and one rounded workspace", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );

    expect(screen.getByTestId('app-sidebar')).toHaveClass('lg:w-64');
    expect(screen.getByTestId('app-workspace')).toHaveClass('lg:rounded-workspace');
  });

  it("keeps the header mobile-only so the desktop workspace owns the route title", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );

    expect(screen.getByTestId('mobile-header')).toHaveClass('lg:hidden');
    expect(within(screen.getByTestId('mobile-header')).getByRole('link', { name: /DocAI/ })).toHaveClass('min-h-11');
  });

  it("places utility controls in the sidebar footer with Vietnamese labels", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );

    expect(screen.getByRole('button', { name: 'Chuyển giao diện' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
  });

  it("renders a localized skip link for accessibility", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );
    expect(screen.getAllByText("Bỏ qua tới nội dung chính").length).toBeGreaterThanOrEqual(1);
  });

  it("uses quiet semantic shell surfaces without legacy chrome", () => {
    const { container } = render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );

    expect(screen.getByTestId('app-workspace')).toHaveClass('bg-workspace');
    expect(container.innerHTML).not.toMatch(/glass-|shadow-glow|bg-void/);
  });

  it("exposes exactly one main landmark", () => {
    render(
      <AppShell>
        <p>test</p>
      </AppShell>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it("announces global loading and error states", () => {
    const { rerender } = render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');

    rerender(<ErrorPage error={new Error('failed')} reset={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Đã xảy ra lỗi');

    rerender(<NotFound />);
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeDefined();
  });

  it("starts each standalone system page at heading level 1", () => {
    const { rerender } = render(<ErrorPage error={new Error('failed')} reset={vi.fn()} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    rerender(<NotFound />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it("offers a recovery action on every system state", () => {
    const reset = vi.fn();
    const { rerender } = render(<ErrorPage error={new Error('failed')} reset={reset} />);
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');

    rerender(<NotFound />);
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Tài liệu' })).toHaveAttribute('href', '/documents');
  });

  it("hides decorative skeleton bars from assistive technology while loading", () => {
    render(<Loading />);

    const status = screen.getByRole('status');
    expect(status).toHaveAccessibleName('Đang tải');
    expect(status.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('makes the closed mobile sidebar non-interactive and uses 44px navigation targets', () => {
    render(<AppShell><p>test</p></AppShell>);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toHaveClass('invisible');
    expect(sidebar).toHaveClass('lg:visible');
    expect(screen.getByRole('link', { name: /Tạo văn bản/ })).toHaveClass('min-h-11');
    expect(screen.getByLabelText('Đóng điều hướng')).toHaveClass('h-11', 'w-11');
  });

  it('transfers focus, traps Tab, closes on Escape, and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<AppShell><button>Background action</button></AppShell>);
    const trigger = screen.getByLabelText('Mở điều hướng');

    await user.click(trigger);
    const close = screen.getByLabelText('Đóng điều hướng');
    expect(close).toHaveFocus();
    expect(screen.getByText('Background action').closest('[inert]')).not.toBeNull();

    // Close is the second control; the brand link is first. Shift+Tab reaches the
    // brand link, then wraps backwards onto the last footer control.
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('link', { name: /DocAI/ })).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
