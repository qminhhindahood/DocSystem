export const INITIAL_STANDALONE_MIGRATION = '20260901000000_init_standalone_auth';

export type ColumnShape = {
  table: string;
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
};

export type KeyShape = {
  kind: 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY' | 'CHECK';
  table: string;
  columns: string[];
  referencedTable?: string;
  referencedColumns?: string[];
  definition?: string;
};

export type DatabaseShape = {
  tables: string[];
  columns: ColumnShape[];
  keys: KeyShape[];
  appliedMigrationNames: string[];
};

export type BaselineAssessment = {
  state: 'fresh' | 'already-migrated' | 'compatible' | 'incompatible';
  diagnostics: string[];
};

type RequiredColumn = Omit<ColumnShape, 'dataType'> & {
  acceptedDataTypes: readonly string[];
};

const PRODUCT_TABLES = ['User', 'PasswordResetToken', 'UserLLMConfig'] as const;

const textColumn = (
  table: string,
  name: string,
  nullable = false,
  hasDefault = false,
): RequiredColumn => ({
  table,
  name,
  acceptedDataTypes: ['text', 'character varying'],
  udtName: 'text',
  nullable,
  hasDefault,
});

const timestampColumn = (
  table: string,
  name: string,
  nullable = false,
  hasDefault = false,
): RequiredColumn => ({
  table,
  name,
  acceptedDataTypes: ['timestamp without time zone'],
  udtName: 'timestamp',
  nullable,
  hasDefault,
});

const REQUIRED_COLUMNS: readonly RequiredColumn[] = [
  textColumn('User', 'id'),
  textColumn('User', 'username'),
  textColumn('User', 'email', true),
  textColumn('User', 'passwordHash'),
  textColumn('User', 'role', false, true),
  { table: 'User', name: 'isDisabled', acceptedDataTypes: ['boolean'], udtName: 'bool', nullable: false, hasDefault: true },
  { table: 'User', name: 'sessionVersion', acceptedDataTypes: ['integer'], udtName: 'int4', nullable: false, hasDefault: true },
  timestampColumn('User', 'createdAt', false, true),
  timestampColumn('User', 'updatedAt'),
  textColumn('PasswordResetToken', 'id'),
  textColumn('PasswordResetToken', 'userId'),
  textColumn('PasswordResetToken', 'tokenHash'),
  timestampColumn('PasswordResetToken', 'expiresAt'),
  timestampColumn('PasswordResetToken', 'usedAt', true),
  timestampColumn('PasswordResetToken', 'createdAt', false, true),
  textColumn('UserLLMConfig', 'id'),
  textColumn('UserLLMConfig', 'userId'),
  textColumn('UserLLMConfig', 'provider'),
  textColumn('UserLLMConfig', 'baseUrl'),
  textColumn('UserLLMConfig', 'model'),
  textColumn('UserLLMConfig', 'encryptedApiKey'),
  textColumn('UserLLMConfig', 'apiKeyIv'),
  textColumn('UserLLMConfig', 'apiKeyAuthTag'),
  timestampColumn('UserLLMConfig', 'createdAt', false, true),
  timestampColumn('UserLLMConfig', 'updatedAt'),
];

const REQUIRED_KEYS: readonly KeyShape[] = [
  { kind: 'PRIMARY KEY', table: 'User', columns: ['id'] },
  { kind: 'UNIQUE', table: 'User', columns: ['username'] },
  { kind: 'UNIQUE', table: 'User', columns: ['email'] },
  { kind: 'PRIMARY KEY', table: 'PasswordResetToken', columns: ['id'] },
  { kind: 'UNIQUE', table: 'PasswordResetToken', columns: ['tokenHash'] },
  { kind: 'FOREIGN KEY', table: 'PasswordResetToken', columns: ['userId'], referencedTable: 'User', referencedColumns: ['id'] },
  { kind: 'PRIMARY KEY', table: 'UserLLMConfig', columns: ['id'] },
  { kind: 'UNIQUE', table: 'UserLLMConfig', columns: ['userId'] },
  { kind: 'FOREIGN KEY', table: 'UserLLMConfig', columns: ['userId'], referencedTable: 'User', referencedColumns: ['id'] },
];

function sameList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function hasRequiredKey(keys: readonly KeyShape[], required: KeyShape): boolean {
  return keys.some((candidate) =>
    candidate.kind === required.kind
    && candidate.table === required.table
    && sameList(candidate.columns, required.columns)
    && sameList(candidate.referencedColumns, required.referencedColumns)
    && candidate.referencedTable === required.referencedTable,
  );
}

function hasGeminiProviderCheck(keys: readonly KeyShape[]): boolean {
  return keys.some((candidate) => {
    if (candidate.kind !== 'CHECK' || candidate.table !== 'UserLLMConfig') return false;
    const definition = (candidate.definition ?? '').toLowerCase().replace(/["()]/g, ' ').replace(/::text/g, '').replace(/\s+/g, ' ').trim();
    return candidate.columns.includes('provider')
      && /\bprovider\s*=\s*'gemini'(?:\s|$)/.test(definition);
  });
}

function describeKey(key: KeyShape): string {
  const columns = key.columns.map((column) => `"${column}"`).join(', ');
  if (key.kind === 'FOREIGN KEY') {
    return `${key.kind} on "${key.table}" (${columns}) referencing "${key.referencedTable}"`;
  }
  return `${key.kind} on "${key.table}" (${columns})`;
}

export function assessMigrationBaseline(snapshot: DatabaseShape): BaselineAssessment {
  if (snapshot.appliedMigrationNames.includes(INITIAL_STANDALONE_MIGRATION)) {
    return { state: 'already-migrated', diagnostics: [] };
  }

  const presentProductTables = PRODUCT_TABLES.filter((table) => snapshot.tables.includes(table));
  if (presentProductTables.length === 0) {
    return { state: 'fresh', diagnostics: [] };
  }

  const diagnostics: string[] = [];
  for (const table of PRODUCT_TABLES) {
    if (!snapshot.tables.includes(table)) {
      diagnostics.push(`Missing required table "${table}".`);
    }
  }

  for (const required of REQUIRED_COLUMNS) {
    const actual = snapshot.columns.find((column) => column.table === required.table && column.name === required.name);
    if (!actual) {
      diagnostics.push(`Missing required column "${required.table}"."${required.name}".`);
      continue;
    }
    const typeCompatible = required.acceptedDataTypes.includes(actual.dataType)
      || (required.udtName === 'text' && actual.udtName === 'varchar');
    if (!typeCompatible || (actual.udtName !== required.udtName && !(required.udtName === 'text' && actual.udtName === 'varchar'))) {
      diagnostics.push(`Column "${required.table}"."${required.name}" has incompatible type ${actual.dataType} (${actual.udtName}).`);
    }
    if (actual.nullable !== required.nullable) {
      diagnostics.push(`Column "${required.table}"."${required.name}" has incompatible nullability.`);
    }
    if (required.hasDefault && !actual.hasDefault) {
      diagnostics.push(`Column "${required.table}"."${required.name}" is missing its required database default.`);
    }
  }

  const requiredNames = new Set(REQUIRED_COLUMNS.map((column) => `${column.table}\0${column.name}`));
  for (const column of snapshot.columns) {
    if (!PRODUCT_TABLES.includes(column.table as typeof PRODUCT_TABLES[number])) continue;
    if (requiredNames.has(`${column.table}\0${column.name}`)) continue;
    if (!column.nullable && !column.hasDefault) {
      diagnostics.push(`Extra column "${column.table}"."${column.name}" is NOT NULL without a default and can block application writes.`);
    }
  }

  for (const required of REQUIRED_KEYS) {
    if (!hasRequiredKey(snapshot.keys, required)) {
      diagnostics.push(`Missing required ${describeKey(required)}.`);
    }
  }
  if (!hasGeminiProviderCheck(snapshot.keys)) {
    diagnostics.push('Missing required Gemini-only provider check on "UserLLMConfig"."provider".');
  }

  return diagnostics.length === 0
    ? { state: 'compatible', diagnostics: [] }
    : { state: 'incompatible', diagnostics };
}
