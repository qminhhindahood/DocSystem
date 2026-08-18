import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-xx'; // gitleaks:allow -- deterministic test-only signing key
process.env.NODE_ENV = 'test';

const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockHash = jest.fn().mockResolvedValue('hashed-password');
const mockCompare = jest.fn();
const mockRequestPasswordReset = jest.fn();
const mockResetPassword = jest.fn();
const mockVerifyTurnstile = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: mockFindUnique, findFirst: mockFindFirst, create: mockCreate },
  },
}));
jest.mock('../services/password_reset_service', () => ({
  requestPasswordReset: (...args: any[]) => mockRequestPasswordReset(...args),
  resetPassword: (...args: any[]) => mockResetPassword(...args),
}));
jest.mock('../services/turnstile_service', () => ({
  verifyTurnstile: (...args: any[]) => mockVerifyTurnstile(...args),
}));

jest.mock('../middleware/user_auth', () => {
  const actual = jest.requireActual('../middleware/user_auth');
  return {
    ...actual,
    hashPassword: (...args: any[]) => mockHash(...args),
    verifyPassword: (...args: any[]) => mockCompare(...args),
  };
});

const authRoutes = require('./auth').default;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');
const fullUser = {
  id: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  passwordHash: 'hashed-password',
  role: 'admin',
  isDisabled: false,
  sessionVersion: 0,
  createdAt,
  updatedAt,
};

function projectSelection(record: any, select: Record<string, any> | undefined): any {
  if (!select) return record;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, selection]) => selection)
      .map(([key, selection]) => {
        if (selection === true) return [key, record[key]];
        return [key, projectSelection(record[key], (selection as any).select)];
      }),
  );
}

describe('user auth route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DISABLE_PUBLIC_REGISTER;
    process.env.PASSWORD_RESET_MODE = 'email';
    mockHash.mockReset();
    mockCompare.mockReset();
    mockHash.mockResolvedValue('hashed-password');
    mockCompare.mockResolvedValue(true);
    mockRequestPasswordReset.mockResolvedValue({ accepted: true });
    mockResetPassword.mockResolvedValue({ success: true });
    mockVerifyTurnstile.mockResolvedValue({ ok: true });
  });

  it('keeps public registration and returns a role-free user session', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockImplementation(async (args: any) => projectSelection(fullUser, args.select));

    const response = await request(app)
      .post('/api/auth/register')
      .set('X-DocAI-Client-IP', '203.0.113.8')
      .send({ username: 'alice', email: ' Alice@Example.COM ', password: 'correct-password', turnstileToken: 'valid-token' });

    expect(response.status).toBe(201);
    expect(response.body.user).toEqual({ id: 'u1', username: 'alice', createdAt: createdAt.toISOString() });
    expect(response.body.user).not.toHaveProperty('role');
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'alice@example.com' }),
    }));
    expect(mockVerifyTurnstile).toHaveBeenCalledWith({ token: 'valid-token', remoteIp: '203.0.113.8' });
    expect(jwt.decode(response.body.token)).toEqual(expect.objectContaining({
      userId: 'u1',
      username: 'alice',
      tokenUse: 'user',
      sessionVersion: 0,
    }));
    expect(jwt.decode(response.body.token)).not.toHaveProperty('role');
  });

  it('fails closed for public registration in production when the flag is absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DISABLE_PUBLIC_REGISTER;
    try {
      const response = await request(app).post('/api/auth/register')
        .send({ username: 'alice', email: 'alice@example.com', password: 'correct-password', turnstileToken: 'valid-token' });
      expect(response.status).toBe(403);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('requires Turnstile before registration database access', async () => {
    const response = await request(app).post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@example.com', password: 'correct-password' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('TURNSTILE_REQUIRED');
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, reason: 'rejected' }, 403, 'TURNSTILE_REJECTED'],
    [{ ok: false, reason: 'unavailable' }, 503, 'TURNSTILE_UNAVAILABLE'],
  ])('fails closed when Turnstile returns %j', async (result, status, code) => {
    mockVerifyTurnstile.mockResolvedValueOnce(result);

    const response = await request(app).post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@example.com', password: 'correct-password', turnstileToken: 'challenge' });

    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps public login and returns a role-free user session', async () => {
    mockFindUnique.mockResolvedValueOnce(fullUser);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'correct-password' });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({ id: 'u1', username: 'alice', createdAt: createdAt.toISOString() });
    expect(response.body.user).not.toHaveProperty('role');
    expect(jwt.decode(response.body.token)).toEqual(expect.objectContaining({ tokenUse: 'user', sessionVersion: 0 }));
    expect(jwt.decode(response.body.token)).not.toHaveProperty('role');
  });

  it('requires a valid email for registration', async () => {
    const response = await request(app).post('/api/auth/register')
      .send({ username: 'alice', email: 'invalid', password: 'correct-password', turnstileToken: 'challenge' });

    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns the same accepted response for every password-reset request', async () => {
    const response = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'Owner@Example.COM' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      success: true,
      message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.',
    });
    expect(mockRequestPasswordReset).toHaveBeenCalledWith('Owner@Example.COM');
  });

  it('resets a password without echoing the token or password', async () => {
    const token = Buffer.alloc(32, 2).toString('base64url');
    const response = await request(app).post('/api/auth/reset-password')
      .send({ token, password: 'new-password-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mockResetPassword).toHaveBeenCalledWith(token, 'new-password-123');
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain('new-password-123');
  });

  it.each([
    ['/api/auth/forgot-password', { email: 'not-an-email' }],
    ['/api/auth/reset-password', { token: 'bad', password: 'short' }],
  ])('blocks %s before input or service work when recovery is disabled', async (path, body) => {
    process.env.PASSWORD_RESET_MODE = 'disabled';

    const response = await request(app).post(path).send(body);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'PASSWORD_RESET_DISABLED',
      error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
    });
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it.each([
    ['missing account', null, 'correct-password'],
    ['disabled account', { ...fullUser, isDisabled: true }, 'correct-password'],
    ['wrong password', fullUser, 'wrong-password'],
  ])('uses a generic credential error for a %s', async (_caseName, user, password) => {
    mockFindUnique.mockResolvedValueOnce(user);
    mockCompare.mockResolvedValueOnce(password === 'correct-password');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid username or password' });
  });

  it('returns safe profile and LLM metadata from me without role', async () => {
    const llmConfig = {
      id: 'cfg1',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:1234',
      model: 'local-model',
      encryptedApiKey: 'never-return-this',
      createdAt,
      updatedAt,
    };
    const profile = { ...fullUser, llmConfig };
    mockFindUnique
      .mockImplementationOnce(async (args: any) => projectSelection(fullUser, args.select))
      .mockImplementationOnce(async (args: any) => projectSelection(profile, args.select));
    const token = jwt.sign(
      { userId: 'u1', username: 'alice', tokenUse: 'user' },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', issuer: 'ai-document-system', audience: 'ai-document-api' },
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: 'u1',
      username: 'alice',
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      llmConfig: {
        id: 'cfg1',
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234',
        model: 'local-model',
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
    });
    expect(response.body.user).not.toHaveProperty('role');
    expect(response.body.user.llmConfig).not.toHaveProperty('encryptedApiKey');
  });
});
