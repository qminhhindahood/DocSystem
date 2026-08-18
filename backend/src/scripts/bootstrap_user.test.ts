import { bootstrapUser, type BootstrapUserDependencies } from './bootstrap_user';

function dependencies(existing: Array<{ id: string; username: string; email: string | null }> = []) {
  const deps: BootstrapUserDependencies & {
    findMatchingUsers: jest.Mock;
    hashPassword: jest.Mock;
    createUser: jest.Mock;
    log: jest.Mock;
  } = {
    findMatchingUsers: jest.fn().mockResolvedValue(existing),
    hashPassword: jest.fn().mockResolvedValue('bcrypt-hash'),
    createUser: jest.fn().mockResolvedValue({ id: 'user-1', username: 'operator', email: 'owner@example.com' }),
    log: jest.fn(),
  };
  return deps;
}

const validInput = {
  username: 'operator',
  email: 'Owner@Example.COM',
  password: 'correct horse battery staple',
};

describe('operator bootstrap', () => {
  it('validates, normalizes, hashes, and creates exactly one operator', async () => {
    const deps = dependencies();

    await expect(bootstrapUser(validInput, deps)).resolves.toEqual({ created: true, userId: 'user-1' });

    expect(deps.findMatchingUsers).toHaveBeenCalledWith('operator', 'owner@example.com');
    expect(deps.hashPassword).toHaveBeenCalledWith(validInput.password);
    expect(deps.createUser).toHaveBeenCalledTimes(1);
    expect(deps.createUser).toHaveBeenCalledWith({
      username: 'operator',
      email: 'owner@example.com',
      passwordHash: 'bcrypt-hash',
    });
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(validInput.password);
  });

  it.each([
    [{ ...validInput, username: 'ab' }, /username/i],
    [{ ...validInput, email: 'not-an-email' }, /email/i],
    [{ ...validInput, password: 'short' }, /password/i],
  ])('rejects invalid account input without touching the database', async (input, message) => {
    const deps = dependencies();

    await expect(bootstrapUser(input, deps)).rejects.toThrow(message);

    expect(deps.findMatchingUsers).not.toHaveBeenCalled();
    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('is idempotent when username and email identify the same account', async () => {
    const deps = dependencies([{ id: 'existing-1', username: 'operator', email: 'owner@example.com' }]);

    await expect(bootstrapUser(validInput, deps)).resolves.toEqual({ created: false, userId: 'existing-1' });

    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(deps.createUser).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(validInput.password);
  });

  it.each([
    [[{ id: 'user-a', username: 'operator', email: 'other@example.com' }]],
    [[{ id: 'user-a', username: 'someone-else', email: 'owner@example.com' }]],
    [[
      { id: 'user-a', username: 'operator', email: 'other@example.com' },
      { id: 'user-b', username: 'someone-else', email: 'owner@example.com' },
    ]],
  ])('fails closed when username or email belongs to a conflicting identity', async (existing) => {
    const deps = dependencies(existing);

    await expect(bootstrapUser(validInput, deps)).rejects.toThrow(/conflict/i);

    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(deps.createUser).not.toHaveBeenCalled();
  });
});
