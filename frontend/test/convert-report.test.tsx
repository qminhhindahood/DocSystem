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
      onClick={() => onSubmitted([{
        jobId: 'warning-job',
        filename: 'warning.pdf',
        file: new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'warning.pdf', {
          type: 'application/pdf',
        }),
      }])}
    >
      Inject warning job
    </button>
  ),
}));

describe('conversion delivery report', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:warning.pdf'),
      revokeObjectURL: vi.fn(),
    });
    getConversionStatus.mockResolvedValue({
      jobId: 'warning-job',
      status: 'completed_with_warnings',
      progress: 1,
      confidence: 0.55,
      degradedPages: [],
    });
    getConversionReport.mockResolvedValue({
      jobId: 'warning-job',
      status: 'completed_with_warnings',
      confidence: 0.55,
      coverage: 0.64,
      degradedPages: [],
      flaggedBlocks: [],
      lowConfidencePages: [],
      demotions: 0,
      pageTypes: { TABLE_HEAVY: 1 },
      warnings: [
        'Bảng không đạt ngưỡng chất lượng; đã dùng văn bản dự phòng.',
        'Độ tin cậy toàn tài liệu thấp hơn ngưỡng bàn giao.',
      ],
      timings: { total_s: 1.2 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows coverage and every warning without hiding the download', async () => {
    render(<ConvertPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inject warning job' }));
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả kiểm tra độ tin cậy' }));
    await act(async () => Promise.resolve());

    expect(screen.getByText(/Độ bao phủ:/)).toHaveTextContent('64%');
    expect(screen.getByText(/Bảng không đạt ngưỡng chất lượng/)).toBeInTheDocument();
    expect(screen.getByText(/Độ tin cậy toàn tài liệu thấp hơn/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Tải/ })[0]).toHaveAttribute(
      'href',
      '/result/warning-job',
    );
  });
});
