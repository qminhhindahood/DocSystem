import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationPage from '@/app/(app)/generate/page';

const apiMocks = vi.hoisted(() => ({
  generateDocument: vi.fn(),
  getDocumentTypes: vi.fn(),
  getTemplateFields: vi.fn(),
  extractFields: vi.fn(),
  uploadPDF: vi.fn(),
  validateDocument: vi.fn(),
  sendEditFeedback: vi.fn(),
  downloadDocumentAsDocx: vi.fn(),
  getTemplates: vi.fn(),
}));

vi.mock('@/lib/api', () => apiMocks);
vi.mock('@/lib/templates-api', () => ({ getTemplates: apiMocks.getTemplates }));
vi.mock('@/components/StreamingDocumentEditor', () => ({
  default: ({ generationComplete }: { generationComplete: boolean }) => (
    <div data-testid="streaming-editor" data-complete={String(generationComplete)} />
  ),
}));
vi.mock('@/components/feature/SourcePanel', () => ({ SourcePanel: () => null }));
vi.mock('@/components/feature/ValidationPanel', () => ({ ValidationPanel: () => null }));
vi.mock('@/components/feature/FeedbackPanel', () => ({ FeedbackPanel: () => null }));
vi.mock('@/components/feature/FidelityWarningPanel', () => ({ FidelityWarningPanel: () => null }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, options, placeholder }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    placeholder: string;
  }) => (
    <select aria-label={placeholder} value={value} onChange={event => onValueChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

describe('generation request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getDocumentTypes.mockResolvedValue({ types: [] });
    apiMocks.getDocumentTypes.mockResolvedValue([]);
    apiMocks.getTemplateFields.mockResolvedValue({ fields: [] });
    apiMocks.getTemplates.mockResolvedValue({
      success: true,
      templates: [{ id: 'template-1', name: 'Mẫu công văn', status: 'READY', docType: 'cong-van' }],
    });
  });

  async function prepareRequest() {
    const user = userEvent.setup();
    render(<GenerationPage />);
    await user.selectOptions(await screen.findByLabelText('Chọn mẫu DOCX'), 'template-1');
    await user.type(screen.getByPlaceholderText('Mô tả nội dung văn bản cần tạo...'), 'Soạn công văn');
    return user;
  }

  it('offers cancellation before the first chunk and keeps one active request', async () => {
    let activeSignal: AbortSignal | undefined;
    apiMocks.generateDocument.mockImplementation((_request: unknown, signal: AbortSignal) => (
      (async function* () {
        activeSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      })()
    ));

    const user = await prepareRequest();
    await user.click(screen.getByRole('button', { name: 'Tạo văn bản' }));

    const cancel = await screen.findByRole('button', { name: 'Hủy tạo văn bản' });
    expect(activeSignal?.aborted).toBe(false);
    expect(apiMocks.generateDocument).toHaveBeenCalledOnce();
    await user.click(cancel);

    expect(activeSignal?.aborted).toBe(true);
    await screen.findByRole('button', { name: 'Tạo văn bản' });
    expect(apiMocks.generateDocument).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Kiểm tra Nghị định 30/2020' })).not.toBeInTheDocument();
  });

  it('shows the four stages and starts at setup', async () => {
    render(<GenerationPage />);

    const progress = await screen.findByRole('list', { name: 'Tiến trình tạo văn bản' });
    for (const label of ['Thiết lập', 'Soạn nội dung', 'Kiểm tra', 'Xuất tài liệu']) {
      expect(within(progress).getByText(label)).toBeInTheDocument();
    }
    // Current step is marked in text, not by color alone.
    expect(within(progress).getByText('(đang thực hiện)')).toBeInTheDocument();
  });

  it('advances to the compose stage while content streams', async () => {
    apiMocks.generateDocument.mockImplementation(() => (
      (async function* () {
        yield { stage: 'writing', chunk: 'Nội dung' };
        yield { stage: 'complete', done: true, documentId: 'doc-1' };
      })()
    ));

    const user = await prepareRequest();
    await user.click(screen.getByRole('button', { name: 'Tạo văn bản' }));

    // `complete` maps to review, never straight to export.
    await waitFor(() => {
      const progress = screen.getByRole('list', { name: 'Tiến trình tạo văn bản' });
      const review = within(progress).getByText('Kiểm tra').closest('span');
      expect(review).toHaveAttribute('aria-current', 'step');
    });
  });

  it('keeps setup values and partial content after a recoverable failure', async () => {
    apiMocks.generateDocument.mockImplementation(() => (
      (async function* () {
        yield { stage: 'writing', chunk: 'Nội dung một phần' };
        yield { stage: 'warning', error: 'Mô hình trả về lỗi' };
      })()
    ));

    const user = await prepareRequest();
    await user.click(screen.getByRole('button', { name: 'Tạo văn bản' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mô hình trả về lỗi');
    // The request can be retried without re-entering the prompt.
    expect(screen.getByPlaceholderText('Mô tả nội dung văn bản cần tạo...')).toHaveValue('Soạn công văn');
    expect(screen.getByTestId('streaming-editor')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo văn bản' })).toBeEnabled());
  });

  it('does not mark a stream complete when it reaches EOF without a terminal event', async () => {
    apiMocks.generateDocument.mockImplementation(() => (
      (async function* () {
        yield { stage: 'writing', chunk: 'Nội dung một phần' };
      })()
    ));

    const user = await prepareRequest();
    await user.click(screen.getByRole('button', { name: 'Tạo văn bản' }));

    expect(await screen.findByText('Luồng tạo văn bản kết thúc mà không có sự kiện hoàn tất')).toBeInTheDocument();
    expect(screen.getByTestId('streaming-editor')).toHaveAttribute('data-complete', 'false');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo văn bản' })).toBeEnabled());
  });
});
