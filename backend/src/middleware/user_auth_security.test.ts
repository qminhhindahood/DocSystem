process.env.JWT_SECRET = 'x'.repeat(32);
process.env.NODE_ENV = 'test';

const mockVerify = jest.fn();
const mockSign = jest.fn();
const mockFindUnique = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: mockFindUnique },
  },
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: mockVerify, sign: mockSign },
  verify: mockVerify,
  sign: mockSign,
}));

const response = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('user JWT validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReturnValue({
      userId: 'u1',
      username: 'alice',
      tokenUse: 'user',
      sessionVersion: 0,
      iat: 1,
      exp: 2,
      iss: 'ai-document-system',
      aud: 'ai-document-api',
    });
    mockFindUnique.mockResolvedValue({ id: 'u1', username: 'alice', isDisabled: false, sessionVersion: 0 });
  });

  it('accepts generated standard JWT claims and reloads the current account', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('token', expect.any(String), {
      algorithms: ['HS256'],
      issuer: 'ai-document-system',
      audience: 'ai-document-api',
    });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, username: true, isDisabled: true, sessionVersion: true },
    });
    expect(req.user).toEqual({ userId: 'u1', username: 'alice', tokenUse: 'user', sessionVersion: 0 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['role', { role: 'admin' }],
    ['unknown custom claim', { tenantId: 'tenant-a' }],
  ])('rejects a token containing %s', async (_label, customClaim) => {
    const { userAuthMiddleware } = require('./user_auth');
    mockVerify.mockReturnValue({
      userId: 'u1',
      username: 'alice',
      tokenUse: 'user',
      iat: 1,
      exp: 2,
      iss: 'ai-document-system',
      aud: 'ai-document-api',
      ...customClaim,
    });
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a validly signed token with no user tokenUse', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    mockVerify.mockReturnValue({ userId: 'u1', username: 'alice', role: 'admin' });
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a disabled account after JWT verification', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    mockFindUnique.mockResolvedValue({ id: 'u1', username: 'alice', isDisabled: true });
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token after the account session version changes', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    mockFindUnique.mockResolvedValue({
      id: 'u1', username: 'alice', isDisabled: false, sessionVersion: 1,
    });
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token after its account is deleted', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    mockFindUnique.mockResolvedValue(null);
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token when the account username has changed', async () => {
    const { userAuthMiddleware } = require('./user_auth');
    mockFindUnique.mockResolvedValue({ id: 'u1', username: 'alice-renamed', isDisabled: false });
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await userAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('signs only user identity claims', () => {
    const { generateToken } = require('./user_auth');

    generateToken({ userId: 'u1', username: 'alice', sessionVersion: 3, role: 'admin' } as any);

    expect(mockSign).toHaveBeenCalledWith(
      { userId: 'u1', username: 'alice', tokenUse: 'user', sessionVersion: 3 },
      expect.any(String),
      {
        expiresIn: '7d',
        issuer: 'ai-document-system',
        audience: 'ai-document-api',
      },
    );
  });
});

describe('optional user JWT validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReturnValue({
      userId: 'u1',
      username: 'alice',
      tokenUse: 'user',
      sessionVersion: 0,
      iat: 1,
      exp: 2,
      iss: 'ai-document-system',
      aud: 'ai-document-api',
    });
    mockFindUnique.mockResolvedValue({ id: 'u1', username: 'alice', isDisabled: false, sessionVersion: 0 });
  });

  it('continues anonymously when no Authorization header is supplied', async () => {
    const { optionalUserAuthMiddleware } = require('./user_auth');
    const req: any = { headers: { authorization: undefined } };
    const res: any = response();
    const next = jest.fn();

    await optionalUserAuthMiddleware(req, res, next);

    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['malformed scheme', 'Basic token'],
    ['empty Bearer credential', 'Bearer '],
  ])('returns 401 for an explicitly supplied %s Authorization header', async (_label, authorization) => {
    const { optionalUserAuthMiddleware } = require('./user_auth');
    const req: any = { headers: { authorization } };
    const res: any = response();
    const next = jest.fn();

    await optionalUserAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('revalidates a supplied token and attaches its user', async () => {
    const { optionalUserAuthMiddleware } = require('./user_auth');
    const req: any = { headers: { authorization: 'Bearer token' } };
    const res: any = response();
    const next = jest.fn();

    await optionalUserAuthMiddleware(req, res, next);

    expect(req.user).toEqual({ userId: 'u1', username: 'alice', tokenUse: 'user', sessionVersion: 0 });
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 401 instead of becoming anonymous for an invalid supplied token', async () => {
    const { optionalUserAuthMiddleware } = require('./user_auth');
    mockVerify.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const req: any = { headers: { authorization: 'Bearer invalid' } };
    const res: any = response();
    const next = jest.fn();

    await optionalUserAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});
