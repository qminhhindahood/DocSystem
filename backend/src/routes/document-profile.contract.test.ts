import express from 'express';
import jwt from 'jsonwebtoken';
import documentProfileRoutes from './document-profile';
import { prisma } from '../utils/prisma';
import { generateToken } from '../middleware/user_auth';

jest.mock('../utils/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userDocumentProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
  },
}));

const mockFindUnique = prisma.userDocumentProfile.findUnique as jest.Mock;
const mockUpsert = prisma.userDocumentProfile.upsert as jest.Mock;
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockQueryRaw = prisma.$queryRawUnsafe as jest.Mock;

describe('document profile API contract', () => {
  let app: express.Express;
  let token: string;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/settings/document-profile', documentProfileRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockUserFindUnique.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      isDisabled: false,
      sessionVersion: 0,
    });
    token = generateToken({ userId: 'u1', username: 'alice' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 without auth token', async () => {
    for (const method of ['get', 'put', 'post'] as const) {
      const path = method === 'post' ? '/reserve-number' : '/';
      const res = await (method === 'get'
        ? require('supertest')(app).get(`/api/settings/document-profile${path}`)
        : method === 'put'
        ? require('supertest')(app).put(`/api/settings/document-profile${path}`).send({})
        : require('supertest')(app).post(`/api/settings/document-profile${path}`).send({}));
      expect(res.status).toBe(401);
    }
  });

  it('returns 401 with invalid token', async () => {
    const res = await require('supertest')(app)
      .get('/api/settings/document-profile/')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  it('only reads req.user.userId (not another user)', async () => {
    const otherProfile = {
      id: 'p2', userId: 'u2', agencyName: 'Bộ KHĐT',
    };
    mockFindUnique.mockResolvedValue(otherProfile);

    // GET — must query by u1, never see u2
    const res = await require('supertest')(app)
      .get('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // findUnique is called with { where: { userId: 'u1' } }
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('returns profile data on GET', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'p1', userId: 'u1', agencyName: 'VPCP', agencyCode: null,
      defaultPlace: null, defaultRecipients: null, signatoryName: null,
      signatoryTitle: null, documentNumberPrefix: null,
      nextDocumentNumber: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await require('supertest')(app)
      .get('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile.agencyName).toBe('VPCP');
  });

  it('returns null profile when no profile exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await require('supertest')(app)
      .get('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
  });

  it('upserts profile on PUT', async () => {
    mockUpsert.mockResolvedValue({
      id: 'p1', userId: 'u1', agencyName: 'VPCP', agencyCode: null,
      defaultPlace: null, defaultRecipients: null, signatoryName: null,
      signatoryTitle: null, documentNumberPrefix: null,
      nextDocumentNumber: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    const res = await require('supertest')(app)
      .put('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`)
      .send({ agencyName: 'VPCP' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects nextDocumentNumber from client', async () => {
    const res = await require('supertest')(app)
      .put('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`)
      .send({ agencyName: 'VPCP', nextDocumentNumber: 99 });
    expect(res.status).toBe(400); // Zod strict rejects unknown keys
    expect(res.body.details?.[0]?.message || res.body.error).toBeDefined();
  });

  it('rejects too many default recipients', async () => {
    const recipients = Array(51).fill('Nguyễn Văn A');
    const res = await require('supertest')(app)
      .put('/api/settings/document-profile/')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultRecipients: recipients });
    expect(res.status).toBe(400); // Zod validation
  });

  it('reserves a document number on POST /reserve-number', async () => {
    mockQueryRaw.mockResolvedValue([{ number: 12n, prefix: 'ABC' }]);

    const res = await require('supertest')(app)
      .post('/api/settings/document-profile/reserve-number')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.documentNumber).toBe('12/ABC');
  });

  it('returns null documentNumber when no profile exists', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const res = await require('supertest')(app)
      .post('/api/settings/document-profile/reserve-number')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.documentNumber).toBeNull();
  });
});
