import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReadyTemplateSelect } from '@/components/templates/ReadyTemplateSelect';
import type { TemplateSummary } from '@/lib/templates-api';

const readyTemplate: TemplateSummary = {
  id: 'ready-1',
  name: 'Mẫu thông báo',
  docType: 'thong-bao',
  status: 'READY',
  analysisConfidence: 0.97,
  rejectionCode: null,
  rejectionReason: null,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  fileSize: 4096,
};

describe('ReadyTemplateSelect', () => {
  it('disables the selector and links to Templates when no ready template exists', () => {
    render(
      <ReadyTemplateSelect
        templates={[]}
        value=""
        onValueChange={vi.fn()}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('link', { name: /đến trang mẫu văn bản/i }))
      .toHaveAttribute('href', '/templates');
    expect(screen.queryByText('-- Chọn mẫu đã sẵn sàng --')).not.toBeInTheDocument();
  });

  it('shows a local API error and retries without claiming the library is empty', async () => {
    const retry = vi.fn();
    render(
      <ReadyTemplateSelect
        templates={[]}
        value=""
        onValueChange={vi.fn()}
        isLoading={false}
        error={new Error('Template API failed')}
        onRetry={retry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Template API failed');
    expect(screen.queryByText(/chưa có mẫu docx/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows loading without exposing an interactive empty selector', () => {
    render(
      <ReadyTemplateSelect
        templates={[]}
        value=""
        onValueChange={vi.fn()}
        isLoading
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveTextContent('Đang tải mẫu DOCX…');
  });

  it('lists and selects only real ready templates', async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(
      <ReadyTemplateSelect
        templates={[readyTemplate]}
        value=""
        onValueChange={change}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Mẫu thông báo' }));
    expect(change).toHaveBeenCalledWith('ready-1');
    expect(screen.queryByRole('option', { name: '-- Chọn mẫu đã sẵn sàng --' })).not.toBeInTheDocument();
  });
});
