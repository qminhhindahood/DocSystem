const mockFetchIdToken = jest.fn();
const mockGetIdTokenClient = jest.fn();

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getIdTokenClient: (...args: unknown[]) => mockGetIdTokenClient(...args),
  })),
}));

import { getCloudRunAuthorization } from './cloud_run_auth';

describe('getCloudRunAuthorization', () => {
  const originalService = process.env.K_SERVICE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.K_SERVICE;
    mockFetchIdToken.mockResolvedValue('signed-token');
    mockGetIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken: mockFetchIdToken } });
  });

  afterAll(() => {
    if (originalService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalService;
  });

  it('omits platform authorization outside Cloud Run', async () => {
    await expect(getCloudRunAuthorization('http://localhost:8001/ready')).resolves.toEqual({});
    expect(mockGetIdTokenClient).not.toHaveBeenCalled();
  });

  it('uses the target origin as audience and returns the serverless authorization header', async () => {
    process.env.K_SERVICE = 'docai-backend';

    await expect(
      getCloudRunAuthorization('https://docai-docling-abc.a.run.app/parse'),
    ).resolves.toEqual({ 'X-Serverless-Authorization': 'Bearer signed-token' });

    expect(mockGetIdTokenClient).toHaveBeenCalledWith('https://docai-docling-abc.a.run.app');
    expect(mockFetchIdToken).toHaveBeenCalledWith('https://docai-docling-abc.a.run.app');
  });
});
