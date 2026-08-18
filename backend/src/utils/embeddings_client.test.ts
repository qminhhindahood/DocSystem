import { EmbeddingsClient } from './embeddings_client';

jest.mock('./cloud_run_auth', () => ({
  getCloudRunAuthorization: jest.fn().mockResolvedValue({
    'X-Serverless-Authorization': 'Bearer platform-token',
  }),
}));

describe('EmbeddingsClient batch limits', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('splits batches by total characters before calling the service', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { texts: string[] };
      return new Response(JSON.stringify({
        embeddings: body.texts.map(() => [0, 1]),
        dimensions: 1024,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new EmbeddingsClient('http://embeddings.test');

    const result = await client.generateBatchEmbeddings(Array.from({ length: 5 }, () => 'x'.repeat(45000)));

    expect(result).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { texts: string[] };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { texts: string[] };
    expect(firstBody.texts).toHaveLength(4);
    expect(secondBody.texts).toHaveLength(1);
  });

  it('authenticates private Cloud Run embedding requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      embedding: [0, 1],
      dimensions: 2,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new EmbeddingsClient('https://embeddings.example.run.app');

    await client.generateEmbedding('hello');

    expect(fetchMock).toHaveBeenCalledWith('https://embeddings.example.run.app/embed', expect.objectContaining({
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Serverless-Authorization': 'Bearer platform-token',
      }),
    }));
  });
});
