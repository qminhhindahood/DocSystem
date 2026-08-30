import {
  assessMigrationBaseline,
  type ColumnShape,
  type DatabaseShape,
  type KeyShape,
} from './migration_baseline';

const INITIAL_MIGRATION = '20260901000000_init_standalone_auth';

const requiredColumns: ColumnShape[] = [
  { table: 'User', name: 'id', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'User', name: 'username', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'User', name: 'email', dataType: 'text', udtName: 'text', nullable: true, hasDefault: false },
  { table: 'User', name: 'passwordHash', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'User', name: 'role', dataType: 'text', udtName: 'text', nullable: false, hasDefault: true },
  { table: 'User', name: 'isDisabled', dataType: 'boolean', udtName: 'bool', nullable: false, hasDefault: true },
  { table: 'User', name: 'sessionVersion', dataType: 'integer', udtName: 'int4', nullable: false, hasDefault: true },
  { table: 'User', name: 'createdAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: true },
  { table: 'User', name: 'updatedAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: false },
  { table: 'PasswordResetToken', name: 'id', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'PasswordResetToken', name: 'userId', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'PasswordResetToken', name: 'tokenHash', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'PasswordResetToken', name: 'expiresAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: false },
  { table: 'PasswordResetToken', name: 'usedAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: true, hasDefault: false },
  { table: 'PasswordResetToken', name: 'createdAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: true },
  { table: 'UserLLMConfig', name: 'id', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'userId', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'provider', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'baseUrl', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'model', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'encryptedApiKey', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'apiKeyIv', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'apiKeyAuthTag', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
  { table: 'UserLLMConfig', name: 'createdAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: true },
  { table: 'UserLLMConfig', name: 'updatedAt', dataType: 'timestamp without time zone', udtName: 'timestamp', nullable: false, hasDefault: false },
];

const requiredKeys: KeyShape[] = [
  { kind: 'PRIMARY KEY', table: 'User', columns: ['id'] },
  { kind: 'UNIQUE', table: 'User', columns: ['username'] },
  { kind: 'UNIQUE', table: 'User', columns: ['email'] },
  { kind: 'PRIMARY KEY', table: 'PasswordResetToken', columns: ['id'] },
  { kind: 'UNIQUE', table: 'PasswordResetToken', columns: ['tokenHash'] },
  { kind: 'FOREIGN KEY', table: 'PasswordResetToken', columns: ['userId'], referencedTable: 'User', referencedColumns: ['id'] },
  { kind: 'PRIMARY KEY', table: 'UserLLMConfig', columns: ['id'] },
  { kind: 'UNIQUE', table: 'UserLLMConfig', columns: ['userId'] },
  { kind: 'FOREIGN KEY', table: 'UserLLMConfig', columns: ['userId'], referencedTable: 'User', referencedColumns: ['id'] },
  { kind: 'CHECK', table: 'UserLLMConfig', columns: ['provider'], definition: "CHECK ((provider = 'gemini'::text))" },
];

function compatibleShape(overrides: Partial<DatabaseShape> = {}): DatabaseShape {
  return {
    tables: ['User', 'PasswordResetToken', 'UserLLMConfig'],
    columns: requiredColumns.map((column) => ({ ...column })),
    keys: requiredKeys.map((key) => ({ ...key, columns: [...key.columns] })),
    appliedMigrationNames: [],
    ...overrides,
  };
}

describe('assessMigrationBaseline', () => {
  it('classifies a database without product tables as fresh', () => {
    expect(assessMigrationBaseline({ tables: ['legacy_audit'], columns: [], keys: [], appliedMigrationNames: [] }))
      .toEqual({ state: 'fresh', diagnostics: [] });
  });

  it('classifies the recorded initial migration as already migrated', () => {
    const shape = compatibleShape({ appliedMigrationNames: [INITIAL_MIGRATION] });
    expect(assessMigrationBaseline(shape)).toEqual({ state: 'already-migrated', diagnostics: [] });
  });

  it('accepts harmless legacy tables and nullable or defaulted extra columns', () => {
    const shape = compatibleShape({
      tables: ['User', 'PasswordResetToken', 'UserLLMConfig', 'legacy_audit'],
      columns: [
        ...requiredColumns,
        { table: 'User', name: 'nickname', dataType: 'text', udtName: 'text', nullable: true, hasDefault: false },
        { table: 'User', name: 'legacyCounter', dataType: 'integer', udtName: 'int4', nullable: false, hasDefault: true },
      ],
    });
    expect(assessMigrationBaseline(shape)).toEqual({ state: 'compatible', diagnostics: [] });
  });

  it('rejects a partial product schema', () => {
    const shape = compatibleShape({ tables: ['User', 'PasswordResetToken'] });
    const result = assessMigrationBaseline(shape);
    expect(result.state).toBe('incompatible');
    expect(result.diagnostics).toContain('Missing required table "UserLLMConfig".');
  });

  it('rejects a missing required column', () => {
    const shape = compatibleShape({ columns: requiredColumns.filter((column) => !(column.table === 'User' && column.name === 'passwordHash')) });
    const result = assessMigrationBaseline(shape);
    expect(result.state).toBe('incompatible');
    expect(result.diagnostics).toContain('Missing required column "User"."passwordHash".');
  });

  it('rejects an incompatible required column type', () => {
    const columns = requiredColumns.map((column) => column.table === 'User' && column.name === 'sessionVersion'
      ? { ...column, dataType: 'bigint', udtName: 'int8' }
      : column);
    const result = assessMigrationBaseline(compatibleShape({ columns }));
    expect(result.state).toBe('incompatible');
    expect(result.diagnostics.join(' ')).toContain('"User"."sessionVersion" has incompatible type');
  });

  it('rejects a missing required key or provider check', () => {
    for (const missing of requiredKeys) {
      const keys = requiredKeys.filter((candidate) => candidate !== missing);
      const result = assessMigrationBaseline(compatibleShape({ keys }));
      expect(result.state).toBe('incompatible');
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('rejects an extra required column without a database default', () => {
    const shape = compatibleShape({
      columns: [
        ...requiredColumns,
        { table: 'PasswordResetToken', name: 'tenant', dataType: 'text', udtName: 'text', nullable: false, hasDefault: false },
      ],
    });
    const result = assessMigrationBaseline(shape);
    expect(result.state).toBe('incompatible');
    expect(result.diagnostics).toContain('Extra column "PasswordResetToken"."tenant" is NOT NULL without a default and can block application writes.');
  });
});
