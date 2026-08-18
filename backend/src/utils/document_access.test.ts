import type { Request } from 'express';
import {
  SYSTEM_ACCESS,
  accessFromRequest,
  documentWhere,
  ragOwnerId,
  type AccessScope,
} from './document_access';

describe('document access policy', () => {
  it('derives a role-free user scope from the revalidated request identity', () => {
    const req = {
      user: { userId: 'user-a', username: 'alice', tokenUse: 'user' },
    } as unknown as Request;

    const scope = accessFromRequest(req);

    expect(scope).toEqual({ kind: 'user', userId: 'user-a' });
    expect(documentWhere(scope)).toEqual({ ownerId: 'user-a' });
    expect(ragOwnerId(scope)).toBe('user-a');
  });

  it('rejects requests without a revalidated user identity', () => {
    const req = {
      user: undefined,
    } as unknown as Request;

    expect(() => accessFromRequest(req)).toThrow('Authenticated user is required');
  });

  it('keeps explicit system maintenance access unscoped', () => {
    const scope: AccessScope = SYSTEM_ACCESS;

    expect(scope).toEqual({ kind: 'system' });
    expect(documentWhere(scope)).toEqual({});
    expect(ragOwnerId(scope)).toBeUndefined();
  });
});
