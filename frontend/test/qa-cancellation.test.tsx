import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QAPage from '@/app/(app)/qa/page';

const mocks = vi.hoisted(() => ({ askQuestion: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({ askQuestion: mocks.askQuestion }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/select', () => ({
  Select: () => <select aria-label="Lọc theo loại"><option>Tất cả loại văn bản</option></select>,
}));

describe('Q&A request cancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aborts the active stream from the initial request state without starting another', async () => {
    let activeSignal: AbortSignal | undefined;
    mocks.askQuestion.mockImplementation((_question: string, _docType: string | undefined, _topK: number, signal: AbortSignal) => (
      (async function* () {
        activeSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      })()
    ));

    const user = userEvent.setup();
    render(<QAPage />);
    await user.type(screen.getByPlaceholderText(/Nhập câu hỏi/), 'Quy định nào áp dụng?');
    await user.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));

    const cancel = await screen.findByRole('button', { name: 'Hủy câu hỏi' });
    expect(activeSignal?.aborted).toBe(false);
    expect(mocks.askQuestion).toHaveBeenCalledOnce();
    await user.click(cancel);

    expect(activeSignal?.aborted).toBe(true);
    await screen.findByRole('button', { name: 'Gửi câu hỏi' });
    expect(mocks.askQuestion).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
