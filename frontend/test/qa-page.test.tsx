import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QAPage from '@/app/(app)/qa/page';

const mocks = vi.hoisted(() => ({ askQuestion: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({ askQuestion: mocks.askQuestion }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ ariaLabel, size }: { ariaLabel?: string; size?: string }) => (
    <select aria-label={ariaLabel} className={size === 'md' ? 'min-h-11' : 'min-h-10'}>
      <option>Tất cả loại văn bản</option>
    </select>
  ),
}));

const source = {
  id: 'src-1',
  content: 'Điều 5. Nguyên tắc soạn thảo văn bản.',
  article: 'Điều 5',
  clause: 'Khoản 2',
};

/** Streams a complete answer with the supplied terminal payload. */
const streamAnswer = (payload: Record<string, unknown>) =>
  mocks.askQuestion.mockImplementation(() => (
    (async function* () {
      yield { event: 'message', data: { stage: 'researching', sources: payload.sources ?? [] } };
      yield { event: 'message', data: { answerChunk: 'Câu trả lời ' } };
      yield { event: 'message', data: { done: true, answer: 'Câu trả lời đầy đủ.', ...payload } };
    })()
  ));

const ask = async (question = 'Quy định nào áp dụng?') => {
  const user = userEvent.setup();
  render(<QAPage />);
  await user.type(screen.getByPlaceholderText(/Nhập câu hỏi/), question);
  await user.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
  return user;
};

beforeEach(() => vi.clearAllMocks());

describe('QAPage layout and provenance', () => {
  it('shows one page heading and an initial empty state', () => {
    render(<QAPage />);

    expect(screen.getByRole('heading', { name: 'Tra cứu văn bản', level: 1 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Bắt đầu đặt câu hỏi' })).toBeVisible();
  });

  it('names the document-type filter and keeps its touch target at least 44px high', () => {
    render(<QAPage />);

    expect(screen.getByRole('combobox', { name: 'Lọc theo loại văn bản' })).toHaveClass('min-h-11');
  });

  it('places the answer in the primary region and sources in a named complementary region', async () => {
    streamAnswer({ sources: [source] });
    await ask();

    const answers = await screen.findByRole('log', { name: 'Câu trả lời' });
    expect(within(answers).getByText('Câu trả lời đầy đủ.')).toBeVisible();

    const sources = screen.getByRole('complementary', { name: 'Nguồn tham khảo' });
    expect(within(sources).getByText(/Điều 5\. Nguyên tắc soạn thảo/)).toBeVisible();
  });

  it('reports the source count supplied by the backend', async () => {
    streamAnswer({ sources: [source, { id: 'src-2', content: 'Điều 6.' }] });
    await ask();

    const sources = await screen.findByRole('complementary', { name: 'Nguồn tham khảo' });
    expect(within(sources).getByText('2 đoạn')).toBeVisible();
  });

  it('omits article and clause metadata that the source does not carry', async () => {
    streamAnswer({ sources: [{ id: 'bare', content: 'Nội dung không có điều khoản.' }] });
    await ask();

    const sources = await screen.findByRole('complementary', { name: 'Nguồn tham khảo' });
    expect(within(sources).getByText('Nội dung không có điều khoản.')).toBeVisible();
    // No citation is fabricated for a source without article/clause fields.
    expect(within(sources).queryByText(/Điều/)).toBeNull();
    expect(within(sources).queryByText(/Khoản/)).toBeNull();
  });

  it('shows article and clause metadata when present', async () => {
    streamAnswer({ sources: [source] });
    await ask();

    const sources = await screen.findByRole('complementary', { name: 'Nguồn tham khảo' });
    expect(within(sources).getByText('Điều 5')).toBeVisible();
    expect(within(sources).getByText('Khoản 2')).toBeVisible();
  });

  it('states low confidence persistently rather than only in a toast', async () => {
    streamAnswer({ sources: [source], lowConfidence: true });
    await ask();

    expect(await screen.findByText(/có thể thiếu căn cứ/i)).toBeVisible();
  });

  it('does not claim low confidence when the backend did not report it', async () => {
    streamAnswer({ sources: [source] });
    await ask();

    await screen.findByText('Câu trả lời đầy đủ.');
    expect(screen.queryByText(/có thể thiếu căn cứ/i)).toBeNull();
  });

  it('explains a no-source answer without inventing provenance', async () => {
    streamAnswer({ sources: [] });
    await ask();

    await screen.findByText('Câu trả lời đầy đủ.');
    expect(screen.getByText('Không có đoạn nguồn nào cho câu trả lời này.')).toBeVisible();
  });

  it('keeps cancellation from starting a second request', async () => {
    let activeSignal: AbortSignal | undefined;
    mocks.askQuestion.mockImplementation(
      (_q: string, _d: string | undefined, _k: number, signal: AbortSignal) => (
        (async function* () {
          activeSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          });
        })()
      ),
    );

    const user = await ask();
    await user.click(await screen.findByRole('button', { name: 'Hủy câu hỏi' }));

    expect(activeSignal?.aborted).toBe(true);
    await screen.findByRole('button', { name: 'Gửi câu hỏi' });
    expect(mocks.askQuestion).toHaveBeenCalledOnce();
  });

  it('offers retry after a failed answer without duplicating the request', async () => {
    mocks.askQuestion.mockImplementation(() => (
      (async function* () {
        yield { event: 'message', data: { error: 'Không tìm thấy tài liệu' } };
      })()
    ));

    await ask();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error' }),
    ));
    expect(mocks.askQuestion).toHaveBeenCalledOnce();

    // The failure persists with a specific retry action rather than only a toast.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không tìm thấy tài liệu');
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeEnabled();
  });

  it('retries the same question exactly once when asked', async () => {
    mocks.askQuestion.mockImplementation(() => (
      (async function* () {
        yield { event: 'message', data: { error: 'Không tìm thấy tài liệu' } };
      })()
    ));

    const user = await ask('Quy định nào áp dụng?');
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Thử lại' }));

    await waitFor(() => expect(mocks.askQuestion).toHaveBeenCalledTimes(2));
    expect(mocks.askQuestion).toHaveBeenLastCalledWith(
      'Quy định nào áp dụng?', undefined, 5, expect.any(AbortSignal),
    );
  });
});
