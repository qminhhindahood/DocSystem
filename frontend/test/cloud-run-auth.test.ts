import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchIdToken, getIdTokenClient } = vi.hoisted(() => ({
  fetchIdToken: vi.fn(),
  getIdTokenClient: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getIdTokenClient = getIdTokenClient;
  },
}));

import { getCloudRunAuthorization } from '@/lib/server/cloud-run-auth';
import { forwardToBackend } from '@/lib/server/backend';

describe('getCloudRunAuthorization', () => {
  const originalService = process.env.K_SERVICE;
  const originalAudience = process.env.BACKEND_ID_TOKEN_AUDIENCE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.K_SERVICE;
    delete process.env.BACKEND_ID_TOKEN_AUDIENCE;
    fetchIdToken.mockResolvedValue('signed-token');
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalService;
    if (originalAudience === undefined) delete process.env.BACKEND_ID_TOKEN_AUDIENCE;
    else process.env.BACKEND_ID_TOKEN_AUDIENCE = originalAudience;
  });

  it('omits platform authorization outside Cloud Run', async () => {
    await expect(getCloudRunAuthorization('http://localhost:3001/api/health')).resolves.toEqual({});
    expect(getIdTokenClient).not.toHaveBeenCalled();
  });

  it('uses the target origin as audience and returns the serverless authorization header', async () => {
    process.env.K_SERVICE = 'docai-frontend';

    await expect(
      getCloudRunAuthorization('https://docai-backend-abc.a.run.app/api/health?full=true'),
    ).resolves.toEqual({ 'X-Serverless-Authorization': 'Bearer signed-token' });

    expect(getIdTokenClient).toHaveBeenCalledWith('https://docai-backend-abc.a.run.app');
    expect(fetchIdToken).toHaveBeenCalledWith('https://docai-backend-abc.a.run.app');
  });

  it('uses the canonical configured audience when requesting a tagged candidate URL', async () => {
    process.env.K_SERVICE = 'docai-frontend';
    process.env.BACKEND_ID_TOKEN_AUDIENCE = 'https://docai-backend-canonical.a.run.app/';

    await getCloudRunAuthorization(
      'https://candidate-release---docai-backend-abc.a.run.app/api/ready',
    );

    expect(getIdTokenClient).toHaveBeenCalledWith('https://docai-backend-canonical.a.run.app');
    expect(fetchIdToken).toHaveBeenCalledWith('https://docai-backend-canonical.a.run.app');
  });

  it('keeps application authorization while forwarding platform authorization', async () => {
    process.env.K_SERVICE = 'docai-frontend';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await forwardToBackend('GET', '/api/settings/llm', {
      headers: { Authorization: 'Bearer user-session' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/settings/llm',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer user-session',
          'X-Serverless-Authorization': 'Bearer signed-token',
        },
      }),
    );
  });
});
