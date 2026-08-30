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

  it('uses one timer and one live region for sustained ten-job monitoring', async () => {
    // jsdom backs requestAnimationFrame with a setInterval, so mounting
    // motion components adds a ~16ms frameloop timer unrelated to polling.
    // Assertions therefore target the 1500ms polling timer specifically.
    const POLL_MS = 1_500;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const view = render(<ConvertPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Inject ten jobs' }));

    const pollCalls = intervalSpy.mock.calls.filter(([, ms]) => ms === POLL_MS);
    expect(pollCalls).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(getConversionStatus).toHaveBeenCalledTimes(6_000);

    view.unmount();
    const pollCallIndex = intervalSpy.mock.calls.findIndex(([, ms]) => ms === POLL_MS);
    const pollTimerId = intervalSpy.mock.results[pollCallIndex]?.value;
    expect(clearSpy).toHaveBeenCalledWith(pollTimerId);
  }, 15_000);
});
