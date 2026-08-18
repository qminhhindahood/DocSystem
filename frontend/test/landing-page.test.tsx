import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from '@/app/page';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'anonymous' }),
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'light', toggle: vi.fn() }),
}));

describe('LandingPage', () => {
  it('presents one compact header and a document-first hero', () => {
    const { container } = render(<LandingPage />);

    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelector('header')).toHaveClass(
      'bg-surface',
      'sticky',
      'z-sticky',
      'h-[52px]',
      'border-hairline',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Văn bản hành chính, từ nguồn đến bản hoàn chỉnh',
    );
  });

  it('offers one primary action and a borderless learning link', () => {
    render(<LandingPage />);

    expect(screen.getByRole('link', { name: /Đăng nhập để soạn thảo/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Khám phá quy trình/ })).toHaveAttribute('href', '#workflow');
  });

  it('describes the real DocAI workflow stages', () => {
    render(<LandingPage />);

    expect(screen.getByText('Nguồn tham chiếu')).toBeVisible();
    expect(screen.getByText('Văn bản hoàn chỉnh')).toBeVisible();
    expect(screen.getByText('Kiểm tra thể thức')).toBeVisible();
  });

  it('contains no legacy decorative style APIs', () => {
    const { container } = render(<LandingPage />);
    expect(container.innerHTML).not.toMatch(
      /glass-|shadow-glow|bg-void|bg-gradient|bg-clip-text|purple-|indigo-|animate-float|bg-grid-pattern/,
    );
  });

  it('uses the named type scale rather than raw display sizes', () => {
    const { container } = render(<LandingPage />);

    // No tiny UI text and no undefined display utilities.
    expect(container.innerHTML).not.toMatch(/text-\[(?:[0-9]|1[0-2])px\]/);
    expect(container.innerHTML).not.toMatch(/text-display-xl|text-product-title/);
  });

  it('makes no fabricated metric or unsupported guarantee', () => {
    render(<LandingPage />);

    // These numbers were invented for visual effect; no backend supplies them.
    for (const claim of [
      /1,240/,
      /đoạn ngữ nghĩa/i,
      /Căn cứ 100%/i,
      /0 Lỗi thể thức/i,
      /45 Điều/i,
      /Mẫu 1\.1/i,
    ]) {
      expect(screen.queryByText(claim)).toBeNull();
    }
  });

  it('does not present fake file names as if they were real user data', () => {
    render(<LandingPage />);

    for (const file of [/Luat_To_Chuc_Chinh_Phu\.pdf/, /Nghi_dinh_30_2020_ND_CP\.docx/, /Quyet_dinh_Thu_tuong_2024\.pdf/]) {
      expect(screen.queryByText(file)).toBeNull();
    }
  });

  it('does not advertise social profiles that do not exist', () => {
    render(<LandingPage />);

    // Previously three placeholder links all pointing at "#".
    for (const network of ['GitHub', 'Twitter', 'LinkedIn']) {
      expect(screen.queryByRole('link', { name: network })).toBeNull();
    }
  });
});
