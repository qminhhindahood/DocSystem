import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRouterReplace = vi.fn();
const mockRefresh = vi.fn();
const AUTH_VALUE = { refresh: mockRefresh, user: { id: '1', username: 'alice' }, status: 'authenticated' as const };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
  usePathname: () => '/templates',
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => AUTH_VALUE,
}));

const mockGetTemplates = vi.fn();
const mockGetTemplate = vi.fn();
vi.mock('@/lib/templates-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/templates-api')>();
  return {
    ...actual,
    getTemplates: (...a: unknown[]) => mockGetTemplates(...a),
    getTemplate: (...a: unknown[]) => mockGetTemplate(...a),
    deleteTemplate: vi.fn(),
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTemplate.mockImplementation(async (id: string) => ({
    success: true,
    template: {
      id, name: 'Review Me', docType: null, status: 'NEEDS_REVIEW',
      analysisConfidence: null, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z', fileSize: 4096, header: '', signatureBlock: '',
      description: null, isActive: true, compatibilityReport: null, semanticMap: null,
      generationSchema: null,
      previewMetadata: { documentFingerprint: 'fp-1', candidates: [], compatibility: [] },
    },
  }));
});

describe('TemplatesPage', () => {
  it('renders loading then empty state', async () => {
    mockGetTemplates.mockResolvedValue({ success: true, templates: [] });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    expect(screen.getByText('Mẫu văn bản')).toBeInTheDocument();
    await screen.findByText('Chưa có mẫu nào');
  });

  it('shows error state on fetch failure', async () => {
    mockGetTemplates.mockRejectedValue(new Error('Network error'));
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('renders template list', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [
        { id: '1', name: 'Test Template', docType: 'quyet-dinh', status: 'READY', analysisConfidence: 0.95, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z', fileSize: 10240 },
        { id: '2', name: 'Pending Doc', docType: 'cong-van', status: 'ANALYZING', analysisConfidence: null, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z', fileSize: 20480 },
      ],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Test Template');
    expect(screen.getByText('Pending Doc')).toBeInTheDocument();
  });

  it('refreshes processing templates until review is required', async () => {
    vi.useFakeTimers();
    try {
      mockGetTemplates
        .mockResolvedValueOnce({
          success: true,
          templates: [{
            id: 'processing', name: 'Processing Template', docType: 'cong-van', status: 'ANALYZING',
            analysisConfidence: null, rejectionCode: null, rejectionReason: null,
            createdAt: '2026-07-18T00:00:00Z', fileSize: 20480,
          }],
        })
        .mockResolvedValueOnce({
          success: true,
          templates: [{
            id: 'processing', name: 'Processing Template', docType: 'cong-van', status: 'NEEDS_REVIEW',
            analysisConfidence: 0.9, rejectionCode: 'CONFIDENCE_GATE_FAILED', rejectionReason: null,
            createdAt: '2026-07-18T00:00:00Z', fileSize: 20480,
          }],
        });
      const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
      renderWithQuery(<TemplatesPage />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('Đang phân tích')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });

      expect(mockGetTemplates).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Xem lại')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows needs review prompt for NEEDS_REVIEW templates', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [
        { id: '1', name: 'Needs Review', docType: 'quyet-dinh', status: 'NEEDS_REVIEW', analysisConfidence: null, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z', fileSize: 10240 },
      ],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Phân tích mẫu đã hoàn tất');
    expect(screen.getByText('Xem lại')).toBeInTheDocument();
  });

  it('shows rejected reason', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [
        { id: '1', name: 'Bad Template', docType: null, status: 'REJECTED', analysisConfidence: null, rejectionCode: 'ANALYSIS_FAILED', createdAt: '2026-07-13T00:00:00Z', fileSize: 5120 },
      ],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Bad Template');
    expect(screen.getByText('ANALYSIS_FAILED')).toBeInTheDocument();
  });

  it('translates typography rejection and shows safe correction guidance', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: 'font-bad', name: 'Arial Template', docType: 'cong-van', status: 'REJECTED',
        analysisConfidence: 0, rejectionCode: 'FONT_RULE_VIOLATION',
        rejectionReason: 'document_number: yêu cầu Times New Roman; hiện tại Arial.',
        createdAt: '2026-07-18T00:00:00Z', fileSize: 5120,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Arial Template');
    expect(screen.getByText('Phông chữ hoặc cỡ chữ chưa đúng quy định')).toBeInTheDocument();
    expect(screen.getByText(/yêu cầu Times New Roman/)).toBeInTheDocument();
    expect(screen.queryByText('FONT_RULE_VIOLATION')).not.toBeInTheDocument();
  });

  it('fidelity guarantee shown only for READY templates', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [
        { id: '1', name: 'Ready Tem', docType: null, status: 'READY', analysisConfidence: 0.88, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z', fileSize: 8192 },
      ],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Ready Tem');
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });

  it.each([
    ['READY', 'Sẵn sàng'],
    ['NEEDS_REVIEW', 'Cần xem lại'],
    ['ANALYZING', 'Đang phân tích'],
    ['UPLOADED', 'Đã tải lên'],
    ['REJECTED', 'Bị từ chối'],
    ['FAILED', 'Thất bại'],
  ])('gives the %s lifecycle state a localized label', async (status, label) => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: '1', name: 'Mẫu kiểm thử', docType: null, status,
        analysisConfidence: null, rejectionCode: null, rejectionReason: null,
        createdAt: '2026-07-13T00:00:00Z', fileSize: 4096,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);

    await screen.findByText('Mẫu kiểm thử');
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not promise fidelity for templates that are not ready', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: '1', name: 'Đang chờ', docType: null, status: 'ANALYZING',
        analysisConfidence: 0.91, rejectionCode: null, rejectionReason: null,
        createdAt: '2026-07-13T00:00:00Z', fileSize: 4096,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);

    await screen.findByText('Đang chờ');
    // Confidence is only substantiated once analysis has finished.
    expect(screen.queryByText(/Độ tin cậy/)).not.toBeInTheDocument();
  });

  it('keeps a long template name readable without clipping the status', async () => {
    const longName = 'Mẫu quyết định về việc điều động và bổ nhiệm công chức giữ chức vụ lãnh đạo cấp phòng thuộc Sở';
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: '1', name: longName, docType: null, status: 'READY',
        analysisConfidence: 0.9, rejectionCode: null, rejectionReason: null,
        createdAt: '2026-07-13T00:00:00Z', fileSize: 4096,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);

    expect(await screen.findByText(longName)).toBeVisible();
    expect(screen.getByText('Sẵn sàng')).toBeVisible();
  });

  it('confirms before deleting and keeps the row pending until it resolves', async () => {
    const user = userEvent.setup();
    const { deleteTemplate } = await import('@/lib/templates-api');
    let release: () => void = () => {};
    vi.mocked(deleteTemplate).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve(undefined as never); }),
    );
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: '1', name: 'Mẫu cần xóa', docType: null, status: 'READY',
        analysisConfidence: 0.9, rejectionCode: null, rejectionReason: null,
        createdAt: '2026-07-13T00:00:00Z', fileSize: 4096,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Mẫu cần xóa');

    await user.click(screen.getByRole('button', { name: 'Xóa Mẫu cần xóa' }));

    // Nothing is deleted until the user confirms.
    expect(deleteTemplate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Mẫu cần xóa');
    await user.click(within(dialog).getByRole('button', { name: 'Xóa mẫu' }));

    expect(deleteTemplate).toHaveBeenCalledWith('1');
    // The template stays visible while deletion is in flight.
    expect(screen.getByText('Mẫu cần xóa')).toBeVisible();
    release();
  });

  it('keeps the template in place and reports a failed deletion', async () => {
    const user = userEvent.setup();
    const { deleteTemplate } = await import('@/lib/templates-api');
    vi.mocked(deleteTemplate).mockRejectedValueOnce(new Error('Không thể xóa mẫu'));
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [{
        id: '1', name: 'Mẫu giữ lại', docType: null, status: 'READY',
        analysisConfidence: 0.9, rejectionCode: null, rejectionReason: null,
        createdAt: '2026-07-13T00:00:00Z', fileSize: 4096,
      }],
    });
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Mẫu giữ lại');

    await user.click(screen.getByRole('button', { name: 'Xóa Mẫu giữ lại' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa mẫu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể xóa mẫu');
    expect(screen.getByText('Mẫu giữ lại')).toBeVisible();
  });

  it('navigates to mapping review on NEEDS_REVIEW card click', async () => {
    mockGetTemplates.mockResolvedValue({
      success: true,
      templates: [
        { id: '1', name: 'Review Me', docType: null, status: 'NEEDS_REVIEW', analysisConfidence: null, rejectionCode: null, createdAt: '2026-07-13T00:00:00Z', fileSize: 4096 },
      ],
    });
    const user = userEvent.setup();
    const { default: TemplatesPage } = await import('@/app/(app)/templates/page');
    renderWithQuery(<TemplatesPage />);
    await screen.findByText('Review Me');
    await user.click(screen.getByText('Xem lại'));
    expect(await screen.findByText('Xem lại ánh xạ trường')).toBeInTheDocument();
  });
});
