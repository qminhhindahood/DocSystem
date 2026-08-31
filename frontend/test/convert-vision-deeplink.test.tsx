import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConvertUploadDialog } from '@/components/convert/ConvertUploadDialog';

const submitConversionsIndividually = vi.fn();
vi.mock('@/lib/convert-api', () => ({
  AuthError: class AuthError extends Error {},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
  },
  submitConversionsIndividually: (...args: unknown[]) => submitConversionsIndividually(...args),
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
// Keep the heavy settings tree out of this test; only the event name matters.
vi.mock('@/components/settings/LLMSettingsDialog', () => ({
  OPEN_LLM_SETTINGS_EVENT: 'open-llm-settings',
  LLMSettingsDialog: () => null,
}));

function Harness({ onSubmitted = vi.fn() }: { onSubmitted?: (jobs: unknown[]) => void }) {
  const [open, setOpen] = useState(true);
  return <ConvertUploadDialog open={open} onOpenChange={setOpen} onSubmitted={onSubmitted} />;
}

const pdfFile = (name = 'scan.pdf') => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanned-PDF 422 deep link to API key settings', () => {
  it('keeps every dialog action at least 44 pixels high', () => {
    render(<Harness />);

    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveClass('h-11', 'w-11');
    expect(screen.getByRole('button', { name: 'Hủy' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Chuyển đổi (0)' })).toHaveClass('min-h-11');
  });

  it('shows the settings deep-link button after a scanned-document rejection', async () => {
    const { ApiError } = await import('@/lib/convert-api');
    const file = pdfFile();
    submitConversionsIndividually.mockResolvedValue({
      jobs: [],
      failures: [{ index: 0, file, error: new (ApiError as any)('Tài liệu có trang quét (scanned) nhưng chưa có khóa API Google Gemini.', 422) }],
    });

    const user = userEvent.setup();
    render(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /Chuyển đổi \(1\)/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('trang quét');
    expect(screen.getByRole('button', { name: 'Cấu hình khóa API' })).toBeInTheDocument();
  });

  it('does not suggest API-key setup for an unrelated 422 rejection', async () => {
    const { ApiError } = await import('@/lib/convert-api');
    const file = pdfFile('protected.pdf');
    submitConversionsIndividually.mockResolvedValue({
      jobs: [],
      failures: [{
        index: 0,
        file,
        error: new (ApiError as any)('PDF được bảo vệ bằng mật khẩu.', 422),
      }],
    });

    const user = userEvent.setup();
    render(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /Chuyển đổi \(1\)/ }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Cấu hình khóa API' })).toBeNull();
  });

  it('the deep-link button dispatches the open-llm-settings event', async () => {
    const { ApiError } = await import('@/lib/convert-api');
    const file = pdfFile();
    submitConversionsIndividually.mockResolvedValue({
      jobs: [],
      failures: [{ index: 0, file, error: new (ApiError as any)('Tài liệu có trang quét (scanned).', 422) }],
    });
    const listener = vi.fn();
    window.addEventListener('open-llm-settings', listener);

    const user = userEvent.setup();
    render(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /Chuyển đổi \(1\)/ }));
    await user.click(await screen.findByRole('button', { name: 'Cấu hình khóa API' }));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('open-llm-settings', listener);
  });

  it('keeps the dialog open and shows the deep link for bulk inline scanned errors', async () => {
    const accepted = pdfFile('a.pdf');
    const rejected = pdfFile('scan.pdf');
    submitConversionsIndividually.mockResolvedValue({
      jobs: [{ index: 0, file: accepted, jobId: 'job-a' }],
      failures: [{
        index: 1,
        file: rejected,
        error: new Error('Tài liệu có trang quét (scanned) nhưng chưa có khóa API Google Gemini.'),
      }],
    });
    const onSubmitted = vi.fn();

    const user = userEvent.setup();
    render(<Harness onSubmitted={onSubmitted} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [accepted, rejected]);
    await user.click(screen.getByRole('button', { name: /Chuyển đổi \(2\)/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('trang quét');
    expect(screen.getByRole('button', { name: 'Cấu hình khóa API' })).toBeInTheDocument();
    // The successful job is still tracked; the dialog stayed open for retry.
    expect(onSubmitted).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ jobId: 'job-a' }),
    ]));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    // Only the failed file remains for retry.
    await waitFor(() => expect(screen.getByText('scan.pdf')).toBeInTheDocument());
    expect(screen.queryByText('a.pdf')).toBeNull();
  });

  it('does not show the deep link for non-422 errors', async () => {
    const file = pdfFile();
    submitConversionsIndividually.mockResolvedValue({
      jobs: [],
      failures: [{ index: 0, file, error: new Error('Máy chủ gặp sự cố') }],
    });

    const user = userEvent.setup();
    render(<Harness />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole('button', { name: /Chuyển đổi \(1\)/ }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Cấu hình khóa API' })).toBeNull();
  });
});
