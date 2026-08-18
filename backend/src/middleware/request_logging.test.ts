import { EventEmitter } from 'node:events';
import { requestLoggingMiddleware } from './request_logging';

describe('request logging middleware', () => {
  it('logs only bounded request metadata and a hashed authenticated user ID', () => {
    const info = jest.fn();
    const req = {
      id: 'request-1', method: 'POST', path: '/api/documents', baseUrl: '',
      headers: { authorization: 'Bearer secret', cookie: 'docai_session=secret' },
      body: { content: 'private document', password: 'secret' },
      user: { userId: 'user-sensitive-id', username: 'alice', tokenUse: 'user', sessionVersion: 0 },
    } as any;
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = 201;
    const next = jest.fn();
    const times = [1_000, 1_025];

    requestLoggingMiddleware(req, res as any, next, {
      logger: { info },
      now: () => times.shift()!,
    });
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1', route: '/api/documents', status: 201, duration: 25,
      method: 'POST', userHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }), 'request completed');
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toMatch(/Bearer secret|docai_session|private document|user-sensitive-id|alice/);
  });
});
