import { beforeEach, describe, expect, it, vi } from 'vitest';

const forwardToBackend = vi.fn();
vi.mock('@/lib/server/backend', () => ({
  forwardToBackend: (...args: unknown[]) => forwardToBackend(...args),
}));

import { GET as live } from '@/app/api/live/route';
import { GET as ready } from '@/app/api/ready/route';

describe('frontend health routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports process liveness without calling the backend', async () => {
    const response = await live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'alive' });
    expect(forwardToBackend).not.toHaveBeenCalled();
  });

  it('reports ready only when the private backend is ready', async () => {
    forwardToBackend.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const response = await ready();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(forwardToBackend).toHaveBeenCalledWith('GET', '/ready');
  });

  it.each([
    ['non-2xx', () => forwardToBackend.mockResolvedValue(new Response('database=down', { status: 503 }))],
    ['unreachable', () => forwardToBackend.mockRejectedValue(new Error('Backend http://private token=secret'))],
  ])('maps a %s backend result to a redacted 503', async (_name, arrange) => {
    arrange();
    const response = await ready();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(body)).not.toMatch(/database|private|secret|http:/);
  });
});
