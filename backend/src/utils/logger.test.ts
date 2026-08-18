import { Writable } from 'node:stream';
import { createLogger, hashUserId } from './logger';

function capture() {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  return { stream, output: () => output };
}

describe('production logger', () => {
  it('emits Cloud Logging fields and aggressively redacts sensitive values', () => {
    const sink = capture();
    const logger = createLogger(sink.stream, { service: 'docai-backend', revision: 'revision-7' });
    const secrets = {
      authorization: 'Bearer user-session-secret',
      cookie: 'docai_session=cookie-secret',
      password: 'password-secret',
      resetToken: 'reset-token-secret',
      apiKey: 'api-key-secret',
      smtpPass: 'smtp-password-secret',
      documentBody: 'private-document-body',
      upstream: 'raw-upstream-payload',
    };

    logger.info({
      requestId: 'request-1', route: '/api/auth/reset-password', status: 200, duration: 12,
      req: { headers: { authorization: secrets.authorization, cookie: secrets.cookie }, body: secrets.documentBody },
      credentials: {
        password: secrets.password,
        token: secrets.resetToken,
        apiKey: secrets.apiKey,
        smtpPass: secrets.smtpPass,
      },
      upstream: { payload: secrets.upstream },
    }, 'request completed');

    const raw = sink.output();
    const record = JSON.parse(raw.trim());
    expect(record).toEqual(expect.objectContaining({
      severity: 'INFO', service: 'docai-backend', revision: 'revision-7',
      requestId: 'request-1', route: '/api/auth/reset-password', status: 200, duration: 12,
    }));
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const secret of Object.values(secrets)) expect(raw).not.toContain(secret);
  });

  it('hashes user IDs consistently without returning the original ID', () => {
    const first = hashUserId('user-sensitive-id');
    expect(first).toBe(hashUserId('user-sensitive-id'));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('user-sensitive-id');
  });
});
