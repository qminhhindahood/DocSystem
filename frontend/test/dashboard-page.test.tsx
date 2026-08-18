import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Dashboard from '@/app/(app)/dashboard/page';

describe('Dashboard', () => {
  it('exposes exactly one page heading', () => {
    render(<Dashboard />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('leads with one prominent document-generation action', () => {
    render(<Dashboard />);

    const primary = screen.getAllByRole('link', { name: /Tạo tài liệu/ });
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAttribute('href', '/generate');
  });

  it('offers real supporting workflow entry points', () => {
    render(<Dashboard />);

    expect(screen.getByRole('link', { name: /Tìm trong tài liệu/ })).toHaveAttribute('href', '/documents');
    expect(screen.getByRole('link', { name: /Hỏi theo nguồn/ })).toHaveAttribute('href', '/qa');
    expect(screen.getByRole('link', { name: /Quản lý mẫu/ })).toHaveAttribute('href', '/templates');
  });

  it('does not fabricate statistics or recent activity', () => {
    const { container } = render(<Dashboard />);

    for (const label of [
      /hoạt động gần đây/i,
      /gần đây/i,
      /thống kê/i,
      /tổng số/i,
      /tuần này/i,
      /tháng này/i,
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // No numeric counters, since the route fetches no data.
    expect(container.textContent).not.toMatch(/\d+\s*(tài liệu|mẫu|văn bản)/);
  });

  it('does not duplicate the global header or navigation', () => {
    render(<Dashboard />);

    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('keeps legacy decorative APIs out of the markup', () => {
    const { container } = render(<Dashboard />);

    expect(container.innerHTML).not.toMatch(/glass-|shadow-glow|animate-float|stagger-in/);
  });

  it('uses product-specific copy rather than generic productivity claims', () => {
    render(<Dashboard />);

    // Real DocAI workflow language, not "boost productivity" filler.
    expect(screen.getAllByText(/mẫu DOCX/i).length).toBeGreaterThan(0);
    for (const claim of [/năng suất/i, /tiết kiệm thời gian/i, /nhanh hơn \d/i]) {
      expect(screen.queryByText(claim)).toBeNull();
    }
  });
});
