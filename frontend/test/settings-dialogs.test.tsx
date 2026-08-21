import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LLMSettingsDialog, OPEN_LLM_SETTINGS_EVENT } from '@/components/settings/LLMSettingsDialog';

const saveLLM = vi.fn();
const getLLM = vi.fn();
const toast = vi.fn();
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/settings-api', () => ({
  AuthError: class AuthError extends Error {},
  getLLMSettings: (...args: unknown[]) => getLLM(...args),
  saveLLMSettings: (...args: unknown[]) => saveLLM(...args),
  testLLMSettings: vi.fn(async () => ({ success: true, model: 'gemini-2.5-flash' })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLLM.mockResolvedValue({
    success: true,
    config: {
      id: '1',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      hasApiKey: true,
    },
  });
  saveLLM.mockResolvedValue({ success: true, config: { hasApiKey: true } });
});

describe('BYOK vision settings dialog', () => {
  it('shows only Gemini and no future-Q&A provider copy', async () => {
    getLLM.mockResolvedValueOnce({ success: true, config: null });
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    await screen.findByLabelText('Nhà cung cấp');

    expect(screen.queryAllByText(/OpenRouter|hỏi đáp sắp ra mắt/i)).toHaveLength(0);
    await user.click(screen.getByLabelText('Nhà cung cấp'));
    expect(screen.queryByRole('option', { name: 'OpenRouter' })).toBeNull();
  });

  it('does not mark an unchanged new-user form dirty after a Strict Mode abort', async () => {
    let resolveSecond: ((value: { success: true; config: null }) => void) | undefined;
    getLLM
      .mockImplementationOnce((signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const user = userEvent.setup();
    render(<React.StrictMode><LLMSettingsDialog /></React.StrictMode>);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    await waitFor(() => expect(getLLM).toHaveBeenCalledTimes(2));
    await act(async () => { resolveSecond?.({ success: true, config: null }); });
    await screen.findByLabelText('Nhà cung cấp');

    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(screen.queryByText('Bỏ các thay đổi chưa lưu?')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('defaults new users to Google Gemini with the official URL', async () => {
    getLLM.mockResolvedValueOnce({ success: true, config: null });
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    expect(await screen.findByLabelText('Nhà cung cấp')).toHaveTextContent('Google Gemini');
    expect(screen.getByLabelText('URL cơ sở')).toHaveValue('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(screen.getByLabelText('Khóa API')).toBeRequired();
  });

  it('has an accessible Vietnamese title and closes after save', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    expect(await screen.findByRole('dialog', { name: 'Cấu hình khóa API' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã lưu cấu hình khóa API', variant: 'success' }));
  });

  it('opens via the open-llm-settings window event (422 deep link)', async () => {
    render(<LLMSettingsDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(OPEN_LLM_SETTINGS_EVENT));
    });
    expect(await screen.findByRole('dialog', { name: 'Cấu hình khóa API' })).toBeInTheDocument();
  });

  it('asks before discarding a dirty form', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    const model = await screen.findByRole('textbox', { name: 'Mô hình' });
    await user.type(model, '-changed');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(await screen.findByText('Bỏ các thay đổi chưa lưu?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
    expect(screen.getByRole('textbox', { name: 'Mô hình' })).toHaveValue('gemini-2.5-flash-changed');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    await user.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
  });

  it('handles load failures explicitly', async () => {
    getLLM.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải cấu hình khóa API.');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('submits the exact Gemini provider contract', async () => {
    getLLM.mockResolvedValueOnce({ success: true, config: null });
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cấu hình khóa API' }));
    await screen.findByLabelText('Nhà cung cấp'); // gemini default loaded
    await user.type(screen.getByLabelText('Mô hình'), 'gemini-2.5-flash');
    await user.type(screen.getByLabelText('Khóa API'), 'gemini-key');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    await waitFor(() => expect(saveLLM).toHaveBeenCalledWith({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
      apiKey: 'gemini-key',
    }));
  });
});
