import { prismaLogLevels } from './prisma';

describe('prismaLogLevels', () => {
  it('does not emit raw SQL by default in development', () => {
    expect(prismaLogLevels('development', undefined)).toEqual(['error', 'warn']);
    expect(prismaLogLevels('development', 'false')).toEqual(['error', 'warn']);
  });

  it('allows raw SQL logging only through an explicit development opt-in', () => {
    expect(prismaLogLevels('development', 'true')).toEqual(['query', 'error', 'warn']);
  });

  it('never enables raw SQL logging in production', () => {
    expect(prismaLogLevels('production', 'true')).toEqual(['error']);
  });
});
