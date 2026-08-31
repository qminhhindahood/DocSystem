import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvertUploadDialog } from '@/components/convert/ConvertUploadDialog';

const submitIndividually = vi.fn();
const refresh = vi.fn();

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ refresh }),
}));

vi.mock('@/lib/convert-api', () => ({
  AuthError: class AuthError extends Error {},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  submitConversionsIndividually: (...args: unknown[]) => submitIndividually(...args),
}));

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: 'application/pdf',
  });
}

describe('ConvertUploadDialog independent submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks successful jobs and leaves only failed files available to retry', async () => {
    const first = pdf('first.pdf');
    const second = pdf('second.pdf');
    const busy = Object.assign(new Error('Hệ thống đang bận. Vui lòng thử lại sau.'), {
      status: 503,
    });
    submitIndividually.mockResolvedValue({
      jobs: [{ index: 0, file: first, jobId: 'job-first' }],
      failures: [{ index: 1, file: second, error: busy }],
    });
    const onSubmitted = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ConvertUploadDialog
        open
        onOpenChange={onOpenChange}
        onSubmitted={onSubmitted}
      />,
    );
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, [first, second]);
    await user.click(screen.getByRole('button', { name: 'Chuyển đổi (2)' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith([{
      jobId: 'job-first',
      filename: 'first.pdf',
      file: first,
    }]));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'second.pdf: Hệ thống đang bận. Vui lòng thử lại sau.',
    );
    expect(screen.getByRole('button', { name: 'Chuyển đổi (1)' })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
