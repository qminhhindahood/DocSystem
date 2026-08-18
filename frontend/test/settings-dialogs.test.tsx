import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LLMSettingsDialog } from '@/components/settings/LLMSettingsDialog';
import { DocumentDefaultsDialog } from '@/components/settings/DocumentDefaultsDialog';

const saveLLM = vi.fn();
const saveProfile = vi.fn();
const getLLM = vi.fn();
const getProfile = vi.fn();
const getModels = vi.fn();
const toast = vi.fn();
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/settings-api', () => ({
  AuthError: class AuthError extends Error {},
  getLLMSettings: (...args: unknown[]) => getLLM(...args),
  getOpenRouterModels: (...args: unknown[]) => getModels(...args),
  saveLLMSettings: (...args: unknown[]) => saveLLM(...args),
  testLLMSettings: vi.fn(async () => ({ success: true, model: 'openai/gpt-4.1-mini' })),
  getDocumentProfile: (...args: unknown[]) => getProfile(...args),
  saveDocumentProfile: (...args: unknown[]) => saveProfile(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLLM.mockResolvedValue({ success: true, config: { id: '1', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', hasApiKey: true } });
  getProfile.mockResolvedValue({ success: true, profile: { id: 'p1', agencyName: 'VPCP', agencyCode: null, defaultPlace: 'Hà Nội', defaultRecipients: [], signatoryName: null, signatoryTitle: null, documentNumberPrefix: null, nextDocumentNumber: 12 } });
  getModels.mockResolvedValue({
    success: true,
    total: 1,
    models: [{
      id: 'openrouter/free', name: 'Free Models Router', provider: 'openrouter',
      contextLength: 200000, promptPricePerMillion: 0, completionPricePerMillion: 0,
      free: true, recommended: true,
    }],
  });
  saveLLM.mockResolvedValue({ success: true, config: { hasApiKey: true } });
  saveProfile.mockResolvedValue({ success: true, profile: {} });
});

describe('LLM settings dialog', () => {
  it('does not mark an unchanged new-user form dirty after a Strict Mode abort', async () => {
    let resolveSecond: ((value: { success: true; config: null }) => void) | undefined;
    getLLM
      .mockImplementationOnce((signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const user = userEvent.setup();
    render(<React.StrictMode><LLMSettingsDialog /></React.StrictMode>);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(getLLM).toHaveBeenCalledTimes(2));
    await act(async () => { resolveSecond?.({ success: true, config: null }); });
    await screen.findByLabelText('Nhà cung cấp');

    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(screen.queryByText('Bỏ các thay đổi chưa lưu?')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('defaults new users to OpenRouter without an operator-wide model', async () => {
    getLLM.mockResolvedValueOnce({ success: true, config: null });
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    expect(await screen.findByLabelText('Nhà cung cấp')).toHaveTextContent('OpenRouter');
    expect(screen.getByLabelText('URL cơ sở')).toHaveValue('https://openrouter.ai/api/v1');
  });

  it('has an accessible Vietnamese title and closes after save', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    expect(await screen.findByRole('dialog', { name: 'Nhà cung cấp LLM' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã lưu cấu hình LLM', variant: 'success' }));
  });

  it('asks before discarding a dirty form', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    await user.click(await screen.findByRole('combobox', { name: 'Mô hình' }));
    await screen.findByRole('option', { name: /Free Models Router/ });
    await user.click(screen.getByRole('button', { name: 'Nhập ID mô hình thủ công' }));
    const model = screen.getByRole('textbox', { name: 'ID mô hình thủ công' });
    await user.type(model, '-changed');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(await screen.findByText('Bỏ các thay đổi chưa lưu?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
    expect(screen.getByRole('textbox', { name: 'ID mô hình thủ công' })).toHaveValue('openai/gpt-4.1-mini-changed');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    await user.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
  });

  it('selects a recommended OpenRouter model and submits its exact ID', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    await user.click(await screen.findByRole('combobox', { name: 'Mô hình' }));
    await user.click(await screen.findByRole('option', { name: /Free Models Router/ }));
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    await waitFor(() => expect(saveLLM).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openrouter',
      model: 'openrouter/free',
    })));
  });

  it('detects provider-only changes and handles load failures explicitly', async () => {
    const user = userEvent.setup();
    const first = render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    const provider = await screen.findByLabelText('Nhà cung cấp');
    provider.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByLabelText('URL cơ sở')).toHaveValue('https://api.openai.com/v1');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(await screen.findByText('Bỏ các thay đổi chưa lưu?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    first.unmount();

    getLLM.mockRejectedValueOnce(new Error('network'));
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải cấu hình LLM.');
    await user.click(screen.getByLabelText('Đóng cài đặt'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('configures Google Gemini with the official compatibility URL', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));

    const provider = await screen.findByRole('combobox', { name: 'Nhà cung cấp' });
    await user.click(provider);
    await user.click(screen.getByRole('option', { name: 'Google Gemini' }));

    expect(screen.getByLabelText('URL cơ sở')).toHaveValue(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    expect(screen.getByLabelText('URL cơ sở')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('Ví dụ: gemini-3.6-flash')).toBeInTheDocument();
    expect(screen.getByLabelText('Khóa API')).toBeRequired();
  });

  it('submits the exact Gemini provider contract', async () => {
    const user = userEvent.setup();
    render(<LLMSettingsDialog />);
    await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
    await user.click(await screen.findByRole('combobox', { name: 'Nhà cung cấp' }));
    await user.click(screen.getByRole('option', { name: 'Google Gemini' }));
    await user.clear(screen.getByLabelText('Mô hình'));
    await user.type(screen.getByLabelText('Mô hình'), 'gemini-3.6-flash');
    await user.type(screen.getByLabelText('Khóa API'), 'gemini-key');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    await waitFor(() => expect(saveLLM).toHaveBeenCalledWith({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.6-flash',
      apiKey: 'gemini-key',
    }));
  });
});

describe('document defaults dialog', () => {
  function Harness() { const [open, setOpen] = useState(true); return <DocumentDefaultsDialog open={open} onOpenChange={setOpen} />; }
  it('does not mark an unchanged empty profile dirty after a Strict Mode abort', async () => {
    let resolveSecond: ((value: { success: true; profile: null }) => void) | undefined;
    getProfile
      .mockImplementationOnce((signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const user = userEvent.setup();
    render(<React.StrictMode><Harness /></React.StrictMode>);
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải thông tin mặc định');
    await act(async () => { resolveSecond?.({ success: true, profile: null }); });
    await screen.findByLabelText('Tên cơ quan');

    await user.click(screen.getByLabelText('Đóng thông tin mặc định'));
    expect(screen.queryByText('Bỏ các thay đổi chưa lưu?')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows server-managed numbering and closes after a successful Vietnamese save', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'Thông tin mặc định' })).toBeInTheDocument();
    expect(screen.getByText('Số này do máy chủ quản lý.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu thông tin mặc định' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã lưu thông tin mặc định' }));
  });

  it('preserves edits after continuing from discard confirmation', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const agency = await screen.findByLabelText('Tên cơ quan');
    await user.type(agency, '-mới');
    await user.click(screen.getByLabelText('Đóng thông tin mặc định'));
    await user.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
    expect(screen.getByLabelText('Tên cơ quan')).toHaveValue('VPCP-mới');
  });
});
