import type { Request } from 'express';

export type UserAccessScope = { kind: 'user'; userId: string };
export type AccessScope = UserAccessScope | { kind: 'system' };

export const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

/** Explicit, non-interactive scope for maintenance and evaluation work. */
export const SYSTEM_ACCESS: AccessScope = { kind: 'system' };

export function accessFromRequest(req: Request): UserAccessScope {
  if (!req.user?.userId) {
    throw new Error('Authenticated user is required');
  }
  return { kind: 'user', userId: req.user.userId };
}

export function documentWhere(scope: AccessScope): { ownerId: string } | {} {
  return scope.kind === 'system' ? {} : { ownerId: scope.userId };
}

export function ragOwnerId(scope: AccessScope): string | undefined {
  return scope.kind === 'system' ? undefined : scope.userId;
}
