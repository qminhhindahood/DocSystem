import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitConversionsIndividually } from './convert-api';

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: 'application/pdf',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('independent conversion submission', () => {
  it('submits every file through the single-file proxy and keeps partial successes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Hệ thống đang bận.' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-3' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const files = [pdf('same.pdf'), pdf('same.pdf'), pdf('third.pdf')];

    const result = await submitConversionsIndividually(files);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/proxy/convert');
      expect(init).toMatchObject({ method: 'POST' });
      expect(init.body).toBeInstanceOf(FormData);
    }
    expect(result.jobs).toEqual([
      { index: 0, file: files[0], jobId: 'job-1' },
      { index: 2, file: files[2], jobId: 'job-3' },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      index: 1,
      file: files[1],
      error: { message: 'Hệ thống đang bận.', status: 503 },
    });
  });
});
