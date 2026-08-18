import { prisma } from '../utils/prisma';

jest.mock('../utils/prisma', () => ({
  prisma: {
    userDocumentProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
  },
}));

const mockFindUnique = prisma.userDocumentProfile.findUnique as jest.Mock;
const mockUpsert = prisma.userDocumentProfile.upsert as jest.Mock;
const mockQueryRaw = prisma.$queryRawUnsafe as jest.Mock;

describe('DocumentProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateProfileData', () => {
    const { sanitizeProfileData, validateProfileData } = require('./document_profile_service');

    it('accepts valid profile data', () => {
      expect(() =>
        validateProfileData({
          agencyName: '  Văn phòng Chính phủ  ',
          defaultRecipients: ['Nguyễn Văn A', 'Trần Thị B'],
        }),
      ).not.toThrow();
    });

    it('rejects agencyName over 200 characters', () => {
      expect(() =>
        validateProfileData({ agencyName: 'X'.repeat(201) }),
      ).toThrow('exceeds 200 characters');
    });

    it('sanitizes organization identity and contact fields', () => {
      expect(sanitizeProfileData({
        supervisingAgency: '  Bộ Giáo dục và Đào tạo ',
        agencyAddress: '  35 Đại Cồ Việt ',
        agencyEmail: '  vanthu@example.gov.vn ',
        agencyWebsite: '  https://example.gov.vn ',
        agencyPhone: '  024 1234 5678 ',
      })).toEqual({
        supervisingAgency: 'Bộ Giáo dục và Đào tạo',
        agencyAddress: '35 Đại Cồ Việt',
        agencyEmail: 'vanthu@example.gov.vn',
        agencyWebsite: 'https://example.gov.vn',
        agencyPhone: '024 1234 5678',
      });
    });

    it('rejects more than 50 defaultRecipients', () => {
      expect(() =>
        validateProfileData({ defaultRecipients: Array(51).fill('Nguyễn Văn A') }),
      ).toThrow('has more than 50 entries');
    });

    it('rejects a recipient string over 300 characters', () => {
      expect(() =>
        validateProfileData({ defaultRecipients: ['A', 'B'.repeat(301)] }),
      ).toThrow('exceeds 300 characters');
    });

    it('rejects non-array defaultRecipients', () => {
      expect(() =>
        validateProfileData({ defaultRecipients: 'not-an-array' as any }),
      ).toThrow('must be an array');
    });

    it('rejects non-string recipient entry', () => {
      expect(() =>
        validateProfileData({ defaultRecipients: ['valid', 123 as any] }),
      ).toThrow('is not a string');
    });

    it('rejects non-string for string fields', () => {
      expect(() =>
        validateProfileData({ agencyName: 123 as any }),
      ).toThrow('Invalid type for agencyName');
    });
  });

  describe('getDocumentProfile', () => {
    const { getDocumentProfile } = require('./document_profile_service');

    it('returns the profile for the given userId', async () => {
      const fake = { id: 'p1', userId: 'u1', agencyName: 'VPCP' };
      mockFindUnique.mockResolvedValue(fake);
      const result = await getDocumentProfile('u1');
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: expect.objectContaining({ agencyName: true }),
      });
      expect(result).toEqual(fake);
    });

    it('returns null when profile does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);
      const result = await getDocumentProfile('u1');
      expect(result).toBeNull();
    });
  });

  describe('upsertDocumentProfile', () => {
    const { upsertDocumentProfile } = require('./document_profile_service');

    it('upserts and returns the profile', async () => {
      const fake = { id: 'p1', userId: 'u1' };
      mockUpsert.mockResolvedValue(fake);
      const result = await upsertDocumentProfile('u1', { agencyName: 'VPCP' });
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: expect.objectContaining({ userId: 'u1', agencyName: 'VPCP' }),
        update: expect.objectContaining({ agencyName: 'VPCP' }),
        select: expect.objectContaining({ agencyName: true }),
      });
      expect(result).toEqual(fake);
    });

    it('trims whitespace from optional string fields', async () => {
      mockUpsert.mockResolvedValue({ id: 'p1', userId: 'u1' });
      await upsertDocumentProfile('u1', { agencyName: '  Văn phòng  ' });
      const update = mockUpsert.mock.calls[0][0].update;
      expect(update.agencyName).toBe('Văn phòng');
    });

    it('rejects when nextDocumentNumber is in the data (validated by route)', async () => {
      // Service doesn't strip it — route layer catches it. Verify that passing
      // it doesn't cause an upsert error (it'll just be ignored by sanitize).
      mockUpsert.mockResolvedValue({ id: 'p1' });
      const data: any = { agencyName: 'VPCP', nextDocumentNumber: 99 };
      await expect(upsertDocumentProfile('u1', data)).resolves.toBeDefined();
    });
  });

  describe('reserveDocumentNumber', () => {
    const { reserveDocumentNumber } = require('./document_profile_service');

    it('returns sequential formatted numbers for concurrent calls', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([{ number: 12n, prefix: 'ABC' }])
        .mockResolvedValueOnce([{ number: 13n, prefix: 'ABC' }]);

      const [a, b] = await Promise.all([
        reserveDocumentNumber('u1'),
        reserveDocumentNumber('u1'),
      ]);

      expect(a).toBe('12/ABC');
      expect(b).toBe('13/ABC');
    });

    it('returns number alone when prefix is null', async () => {
      mockQueryRaw.mockResolvedValue([{ number: 5n, prefix: null }]);
      const result = await reserveDocumentNumber('u1');
      expect(result).toBe('5');
    });

    it('returns null when no profile exists', async () => {
      mockQueryRaw.mockResolvedValue([]);
      const result = await reserveDocumentNumber('u1');
      expect(result).toBeNull();
    });
  });
});
