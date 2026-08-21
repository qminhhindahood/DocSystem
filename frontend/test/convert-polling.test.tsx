import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConvertPage from '@/app/(app)/convert/page';

const getConversionStatus = vi.fn();

vi.mock('@/lib/convert-api', () => ({
  getConversionStatus: (...args: unknown[]) => getConversionStatus(...args),
  getConversionReport: vi.fn(),
  conversionResultUrl: (jobId: string) => `/result/${jobId}`,
}));

vi.mock('@/components/convert/ConvertUploadDialog', () => ({
  ConvertUploadDialog: ({ onSubmitted }: { onSubmitted: (jobs: unknown[]) => void }) => (
    <button
      type="button"
      onClick={() => onSubmitted(Array.from({ length: 10 }, (_, index) => ({
        jobId: `job-${index}`,
        filename: `document-${index}.pdf`,
        file: new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], `document-${index}.pdf`, {
          type: 'application/pdf',
        }),
      })))}
    >
      Inject ten jobs
    </button>
  ),
}));

describe('conversion polling scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
    getConversionStatus.mockResolvedValue({
      jobId: 'job',
      status: 'processing',
      progress: 0.5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses one timer for ten active jobs and clears it on unmount', async () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const view = render(<ConvertPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Inject ten jobs' }));

    expect(intervalSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(getConversionStatus).toHaveBeenCalledTimes(10);

    view.unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
