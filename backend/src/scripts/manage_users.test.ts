import {
  manageUsers,
  type ManageUsersDependencies,
} from './manage_users';

function dependencies() {
  const deps: ManageUsersDependencies & {
    listUsers: jest.Mock;
    findUsers: jest.Mock;
    setDisabled: jest.Mock;
    deleteUser: jest.Mock;
    log: jest.Mock;
  } = {
    listUsers: jest.fn(),
    findUsers: jest.fn(),
    setDisabled: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
    log: jest.fn(),
  };
  return deps;
}

const target = {
  id: 'user-1',
  username: 'alice',
  isDisabled: false,
};

describe('operator user management', () => {
  it('lists only safe account metadata', async () => {
    const deps = dependencies();
    deps.listUsers.mockResolvedValue([{
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
      isDisabled: false,
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    }]);

    await manageUsers({ action: 'list', username: '', confirm: '' }, deps);

    const output = deps.log.mock.calls[0][0];
    expect(JSON.parse(output)).toEqual({ users: [{
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
      isDisabled: false,
      createdAt: '2026-08-31T00:00:00.000Z',
    }] });
    expect(output).not.toMatch(/password|encryptedApiKey|apiKeyIv|apiKeyAuthTag/i);
  });

  it.each([
    ['disable' as const, true],
    ['enable' as const, false],
  ])('%s targets one exact canonical username and revokes sessions', async (action, disabled) => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue([target]);

    await manageUsers({ action, username: ' alice ', confirm: '' }, deps);

    expect(deps.findUsers).toHaveBeenCalledWith('alice');
    expect(deps.setDisabled).toHaveBeenCalledWith('user-1', disabled);
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', []],
    ['ambiguous', [target, { ...target, id: 'user-2' }]],
    ['non-canonical', [{ ...target, username: 'Alice' }]],
  ])('refuses a %s mutation target', async (_caseName, users) => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue(users);

    await expect(manageUsers({
      action: 'disable',
      username: 'alice',
      confirm: '',
    }, deps)).rejects.toThrow(/refused/i);

    expect(deps.setDisabled).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('requires the canonical username a second time before deletion', async () => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue([target]);

    await expect(manageUsers({
      action: 'delete',
      username: 'alice',
      confirm: 'wrong-user',
    }, deps)).rejects.toThrow(/confirmation/i);

    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('permanently deletes the exactly confirmed account', async () => {
    const deps = dependencies();
    deps.findUsers.mockResolvedValue([target]);

    await manageUsers({
      action: 'delete',
      username: 'alice',
      confirm: 'alice',
    }, deps);

    expect(deps.deleteUser).toHaveBeenCalledWith('user-1');
    expect(deps.setDisabled).not.toHaveBeenCalled();
  });
});
