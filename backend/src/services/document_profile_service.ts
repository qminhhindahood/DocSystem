import { prisma } from '../utils/prisma';

export interface DocumentProfileData {
  supervisingAgency?: string | null;
  agencyName?: string | null;
  agencyCode?: string | null;
  agencyAddress?: string | null;
  agencyEmail?: string | null;
  agencyWebsite?: string | null;
  agencyPhone?: string | null;
  defaultPlace?: string | null;
  defaultRecipients?: string[] | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  documentNumberPrefix?: string | null;
}

const MAX_STRLEN = (field: string) => {
  const limits: Record<string, number> = {
    supervisingAgency: 200,
    agencyName: 200,
    agencyCode: 50,
    agencyAddress: 500,
    agencyEmail: 254,
    agencyWebsite: 500,
    agencyPhone: 50,
    defaultPlace: 200,
    signatoryName: 200,
    signatoryTitle: 200,
    documentNumberPrefix: 50,
    defaultRecipients: 50, // max entries
    recipient: 300,        // each recipient string
  };
  return limits[field] ?? 200;
};

function trimOptional(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return v;
  const t = (v as string).trim();
  return t.length > 0 ? t : null;
}

export function validateProfileData(data: DocumentProfileData): void {
  const stringFields: Array<keyof DocumentProfileData> = [
    'supervisingAgency', 'agencyName', 'agencyCode', 'agencyAddress',
    'agencyEmail', 'agencyWebsite', 'agencyPhone', 'defaultPlace',
    'signatoryName', 'signatoryTitle', 'documentNumberPrefix',
  ];

  for (const field of stringFields) {
    const v = data[field];
    if (v !== undefined && v !== null) {
      if (typeof v !== 'string') throw new Error(`Invalid type for ${field}: expected string`);
      const max = MAX_STRLEN(field);
      if (v.trim().length > max) throw new Error(`${field} exceeds ${max} characters`);
    }
  }

  if (data.defaultRecipients !== undefined && data.defaultRecipients !== null) {
    if (!Array.isArray(data.defaultRecipients)) {
      throw new Error('defaultRecipients must be an array of strings');
    }
    const maxEntries = MAX_STRLEN('defaultRecipients');
    if (data.defaultRecipients.length > maxEntries) {
      throw new Error(`defaultRecipients has more than ${maxEntries} entries`);
    }
    for (let i = 0; i < data.defaultRecipients.length; i++) {
      const r = data.defaultRecipients[i];
      if (typeof r !== 'string') {
        throw new Error(`defaultRecipients[${i}] is not a string`);
      }
      const maxR = MAX_STRLEN('recipient');
      if (r.trim().length > maxR) {
        throw new Error(`defaultRecipients[${i}] exceeds ${maxR} characters`);
      }
    }
  }
}

export function sanitizeProfileData(data: DocumentProfileData): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  const stringFields: Array<keyof DocumentProfileData> = [
    'supervisingAgency', 'agencyName', 'agencyCode', 'agencyAddress',
    'agencyEmail', 'agencyWebsite', 'agencyPhone', 'defaultPlace',
    'signatoryName', 'signatoryTitle', 'documentNumberPrefix',
  ];

  for (const field of stringFields) {
    const v = data[field];
    if (v !== undefined) {
      sanitized[field] = trimOptional(v);
    }
  }

  if (data.defaultRecipients !== undefined) {
    sanitized.defaultRecipients = data.defaultRecipients !== null
      ? data.defaultRecipients.map((r) => r.trim()).filter(Boolean)
      : null;
  }

  return sanitized;
}

export async function getDocumentProfile(userId: string) {
  return prisma.userDocumentProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      supervisingAgency: true,
      agencyName: true,
      agencyCode: true,
      agencyAddress: true,
      agencyEmail: true,
      agencyWebsite: true,
      agencyPhone: true,
      defaultPlace: true,
      defaultRecipients: true,
      signatoryName: true,
      signatoryTitle: true,
      documentNumberPrefix: true,
      nextDocumentNumber: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function upsertDocumentProfile(
  userId: string,
  data: DocumentProfileData,
) {
  validateProfileData(data);
  const sanitized = sanitizeProfileData(data);

  return prisma.userDocumentProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...sanitized as any, // Prisma JSON nullable types
    },
    update: sanitized as any,
    select: {
      id: true,
      userId: true,
      supervisingAgency: true,
      agencyName: true,
      agencyCode: true,
      agencyAddress: true,
      agencyEmail: true,
      agencyWebsite: true,
      agencyPhone: true,
      defaultPlace: true,
      defaultRecipients: true,
      signatoryName: true,
      signatoryTitle: true,
      documentNumberPrefix: true,
      nextDocumentNumber: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Atomically reserve the next document number for a user.
 *
 * Uses UPDATE ... SET nextDocumentNumber = nextDocumentNumber + 1 RETURNING
 * so concurrent calls receive distinct sequential numbers.
 *
 * Returns "<number>/<prefix>" when a prefix exists, or "<number>" alone.
 * Returns null when the user has no profile (so callers can require input
 * instead of inventing a number).
 */
export async function reserveDocumentNumber(
  userId: string,
): Promise<string | null> {
  const result = await prisma.$queryRawUnsafe<Array<{
    number: bigint;
    prefix: string | null;
  }>>(
    `UPDATE "UserDocumentProfile"
     SET "nextDocumentNumber" = "nextDocumentNumber" + 1,
         "updatedAt" = NOW()
     WHERE "userId" = $1
     RETURNING "nextDocumentNumber" - 1 AS "number", "documentNumberPrefix" AS "prefix"`,
    userId,
  );

  if (!result || result.length === 0) return null;

  const { number, prefix } = result[0];
  const n = Number(number);
  return prefix ? `${n}/${prefix}` : String(n);
}
