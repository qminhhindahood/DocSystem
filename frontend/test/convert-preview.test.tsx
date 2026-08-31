import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConvertPage from '@/app/(app)/convert/page';

const getConversionStatus = vi.fn();
const getConversionReport = vi.fn();

vi.mock('@/lib/convert-api', () => ({
  getConversionStatus: (...args: unknown[]) => getConversionStatus(...args),
  getConversionReport: (...args: unknown[]) => getConversionReport(...args),
  conversionResultUrl: (jobId: string) => `/result/${jobId}`,
}));

vi.mock('@/components/convert/ConvertUploadDialog', () => ({
  ConvertUploadDialog: ({ onSubmitted }: { onSubmitted: (jobs: unknown[]) => void }) => (
    <button
      type="button"
      onClick={() => onSubmitted([0, 1].map((index) => ({
        jobId: `job-${index}`,
        filename: `document-${index}.pdf`,
        file: new File([`%PDF-${index}`], `document-${index}.pdf`, { type: 'application/pdf' }),
      })))}
    >
      Inject two jobs
    </button>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function finishFirstPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

describe('conversion source preview and state lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
    getConversionStatus.mockImplementation(async (jobId: string) => ({
      jobId,
      status: jobId === 'job-0' ? 'completed' : 'processing',
      progress: jobId === 'job-0' ? 1 : 0.5,
      confidence: jobId === 'job-0' ? 0.9 : null,
      degradedPages: [],
    }));
    getConversionReport.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('creates one source URL lazily and revokes it on replacement and close', async () => {
    render(<ConvertPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inject two jobs' }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    getConversionStatus.mockImplementation(async (jobId: string) => ({
      jobId,
      status: 'completed',
      progress: 1,
      confidence: 0.9,
      degradedPages: [],
    }));
    await finishFirstPoll();

    const sourceButtons = screen.getAllByRole('button', { name: 'Xem PDF gốc' });
    fireEvent.click(sourceButtons[0]!);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTitle(/PDF gốc:/)).toHaveLength(1);

    fireEvent.click(sourceButtons[1]!);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-0.pdf');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTitle(/PDF gốc:/)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Đóng bản xem trước' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-1.pdf');
    expect(screen.queryByTitle(/PDF gốc:/)).not.toBeInTheDocument();
  });

  it('revokes the active source URL on unmount', async () => {
    const view = render(<ConvertPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inject two jobs' }));
    await finishFirstPoll();
    fireEvent.click(screen.getByRole('button', { name: 'Xem PDF gốc' }));

    view.unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-0.pdf');
  });

  it('keeps a completed report open when another job poll resolves', async () => {
    const secondPoll = deferred<{
      jobId: string;
      status: 'processing';
      progress: number;
      degradedPages: never[];
    }>();
    let jobOneCalls = 0;
    getConversionStatus.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-0') {
        return { jobId, status: 'completed', progress: 1, confidence: 0.9, degradedPages: [] };
      }
      jobOneCalls += 1;
      if (jobOneCalls === 1) {
        return { jobId, status: 'processing', progress: 0.4, degradedPages: [] };
      }
      return secondPoll.promise;
    });
    render(<ConvertPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inject two jobs' }));
    await finishFirstPoll();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả kiểm tra độ tin cậy' }));
    expect(screen.getByTestId('convert-report-job-0')).toBeVisible();

    await act(async () => {
      secondPoll.resolve({ jobId: 'job-1', status: 'processing', progress: 0.6, degradedPages: [] });
      await Promise.resolve();
    });

    expect(screen.getByTestId('convert-report-job-0')).toBeVisible();
  });
});
