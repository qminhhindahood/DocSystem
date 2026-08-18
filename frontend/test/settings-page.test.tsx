import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stable mocks to avoid infinite re-render loops from useCallback([auth])
const mockRouterReplace = vi.fn();
const mockRefresh = vi.fn();
const AUTH_VALUE = { refresh: mockRefresh, user: { id: '1', username: 'alice' }, status: 'authenticated' as const };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
  usePathname: () => '/settings',
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => AUTH_VALUE,
}));

const mockGet = vi.fn();
const mockSave = vi.fn();
vi.mock('@/lib/settings-api', () => ({
  getLLMSettings: (...a: unknown[]) => mockGet(...a),
  saveLLMSettings: (...a: unknown[]) => mockSave(...a),
  testLLMSettings: vi.fn().mockResolvedValue({ success: false }),
  deleteLLMSettings: vi.fn().mockResolvedValue({ success: true }),
  getDocumentProfile: vi.fn().mockResolvedValue({ success: true, profile: null }),
  saveDocumentProfile: vi.fn().mockResolvedValue({ success: true, profile: null }),
  AuthError: class extends Error { constructor() { super('Unauthorized'); this.name = 'AuthError'; } },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('LLMSettingsForm', () => {
  it('renders a Vietnamese loading state then the form', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    render(<LLMSettingsForm />);

    expect(screen.getByRole('status')).toHaveAccessibleName('Đang tải cấu hình');
    expect(await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' })).toBeInTheDocument();
  });

  it('keeps every visible label and action in Vietnamese', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });

    expect(screen.getByLabelText('Nhà cung cấp')).toBeInTheDocument();
    expect(screen.getByLabelText('URL cơ sở')).toBeInTheDocument();
    expect(screen.getByLabelText('Mô hình')).toBeInTheDocument();
    expect(screen.getByLabelText('Khóa API')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kiểm tra kết nối' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa cấu hình' })).toBeInTheDocument();
  });

  it('populates form from existing config', async () => {
    mockGet.mockResolvedValue({
      success: true,
      config: { id: '1', provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' },
    });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    render(<LLMSettingsForm />);

    expect(await screen.findByDisplayValue('http://localhost:11434')).toBeInTheDocument();
  });

  it('triggers save on submit and announces the saved state', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    mockSave.mockResolvedValue({ success: true, config: { id: '1' } });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    const user = userEvent.setup();
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });
    await user.type(screen.getByLabelText('URL cơ sở'), 'http://localhost:11434');
    await user.type(screen.getByLabelText('Mô hình'), 'llama3');
    await user.type(screen.getByLabelText('Khóa API'), 'test-key');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    await waitFor(() => { expect(screen.getByText('Đã lưu')).toBeInTheDocument(); });
    // Payload shape is unchanged by the redesign.
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openrouter', model: 'llama3' }),
      expect.anything(),
    );
  });

  it('keeps edits in place and exposes retry when a save fails', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    mockSave.mockRejectedValue(new Error('Không thể lưu cấu hình'));
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    const user = userEvent.setup();
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });
    await user.type(screen.getByLabelText('Mô hình'), 'llama3');
    await user.type(screen.getByLabelText('Khóa API'), 'test-key');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể lưu cấu hình');
    expect(screen.getByLabelText('Mô hình')).toHaveValue('llama3');
    expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeEnabled();
  });

  it('disables inputs while a request is pending', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    let release: (value: unknown) => void = () => {};
    mockSave.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    const user = userEvent.setup();
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });
    await user.type(screen.getByLabelText('Mô hình'), 'llama3');
    await user.type(screen.getByLabelText('Khóa API'), 'test-key');
    await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

    expect(screen.getByLabelText('URL cơ sở')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lưu cấu hình' })).toBeDisabled();
    release({ success: true, config: { id: '1' } });
  });

  it('confirms in Vietnamese before deleting the configuration', async () => {
    mockGet.mockResolvedValue({
      success: true,
      config: { id: '1', provider: 'lmstudio', baseUrl: 'http://localhost:1234', model: 'test' },
    });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    const user = userEvent.setup();
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });
    await user.click(screen.getByRole('button', { name: 'Xóa cấu hình' }));

    expect(screen.getByRole('button', { name: 'Xác nhận xóa' })).toBeInTheDocument();
  });

  it('keeps the secondary form aligned with the Gemini provider contract', async () => {
    mockGet.mockResolvedValue({ success: true, config: null });
    const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
    const user = userEvent.setup();
    render(<LLMSettingsForm />);
    await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });

    await user.click(screen.getByRole('combobox', { name: 'Nhà cung cấp' }));
    await user.click(screen.getByRole('option', { name: 'Google Gemini' }));

    expect(screen.getByLabelText('URL cơ sở')).toHaveValue(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    expect(screen.getByLabelText('URL cơ sở')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText('Ví dụ: gemini-3.6-flash')).toBeInTheDocument();
    expect(screen.getByLabelText('Khóa API')).toBeRequired();
  });
});
