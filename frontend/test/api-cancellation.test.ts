import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPDF } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API cancellation propagation', () => {
  it('passes the active signal through PDF upload', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ documentId: 'document-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await uploadPDF(new File(['pdf'], 'source.pdf', { type: 'application/pdf' }), 'cong-van', controller.signal);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
