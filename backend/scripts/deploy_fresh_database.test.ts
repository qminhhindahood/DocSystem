import {
  BASELINE_MIGRATION,
  deployFreshDatabase,
  type CatalogInspection,
  type DeployFreshDatabaseDependencies,
} from './deploy_fresh_database';

const emptyInspection = (): CatalogInspection => ({
  publicSchemaExists: true,
  prismaMigrationsRelationExists: false,
  applicationTables: [],
  applicationObjects: [],
  appliedMigrations: [],
});

const dependencies = (
  inspection: CatalogInspection | Error = emptyInspection(),
): DeployFreshDatabaseDependencies & {
  prepareDatabase: jest.Mock;
  inspectCatalog: jest.Mock;
  runNative: jest.Mock;
} => ({
  prepareDatabase: jest.fn().mockResolvedValue('0.8.0'),
  inspectCatalog: inspection instanceof Error
    ? jest.fn().mockRejectedValue(inspection)
    : jest.fn().mockResolvedValue(inspection),
  runNative: jest.fn(),
});

test('verifies pgvector and deploys the complete migration chain on an empty target', async () => {
  const deps = dependencies();

  await deployFreshDatabase('postgresql://empty-target/example', deps);

  expect(deps.prepareDatabase).toHaveBeenCalledWith('postgresql://empty-target/example');
  expect(deps.inspectCatalog).toHaveBeenCalledWith('postgresql://empty-target/example');
  expect(deps.runNative.mock.calls).toEqual([
    [
      'npx',
      ['prisma', 'migrate', 'resolve', '--applied', BASELINE_MIGRATION],
      'postgresql://empty-target/example',
    ],
    [
      'npx',
      ['prisma', 'migrate', 'deploy'],
      'postgresql://empty-target/example',
    ],
  ]);
});

test.each([
  {
    name: 'application tables',
    inspection: {
      publicSchemaExists: true,
      prismaMigrationsRelationExists: false,
      applicationTables: ['Document'],
      applicationObjects: [],
      appliedMigrations: [],
    },
  },
  {
    name: 'applied migration state',
    inspection: {
      publicSchemaExists: true,
      prismaMigrationsRelationExists: false,
      applicationTables: [],
      applicationObjects: [],
      appliedMigrations: ['20260513195302_init'],
    },
  },
])('refuses a target containing $name before migration', async ({ inspection }) => {
  const deps = dependencies(inspection);

  await expect(
    deployFreshDatabase('postgresql://managed-target/example', deps),
  ).rejects.toThrow('Refusing fresh-database deployment');
  expect(deps.runNative).not.toHaveBeenCalled();
});

test.each([
  'empty, perfectly shaped table',
  'perfectly shaped table with rows',
  'malformed table',
  'constrained table',
  'other existing relation',
])('refuses an existing _prisma_migrations %s before migration', async (name) => {
  const deps = dependencies({
    publicSchemaExists: true,
    prismaMigrationsRelationExists: true,
    applicationTables: [],
    applicationObjects: [],
    appliedMigrations: [],
  });

  await expect(
    deployFreshDatabase('postgresql://managed-target/example', deps),
  ).rejects.toThrow('Refusing fresh-database deployment');
  expect(deps.runNative).not.toHaveBeenCalled();
});

test.each([
  ['view', 'view:document_summary'],
  ['materialized view', 'materialized view:document_stats'],
  ['sequence', 'sequence:document_number_seq'],
  ['foreign table', 'foreign table:external_documents'],
])('refuses a target containing a non-extension-owned %s before migration', async (_, object) => {
  const deps = dependencies({
    publicSchemaExists: true,
    prismaMigrationsRelationExists: false,
    applicationTables: [],
    applicationObjects: [object],
    appliedMigrations: [],
  });

  await expect(
    deployFreshDatabase('postgresql://managed-target/example', deps),
  ).rejects.toThrow('Refusing fresh-database deployment');
  expect(deps.runNative).not.toHaveBeenCalled();
});

test('fails closed when catalog inspection cannot reach the target', async () => {
  const deps = dependencies(new Error('connection refused'));

  await expect(
    deployFreshDatabase('postgresql://unreachable/example', deps),
  ).rejects.toThrow('connection refused');
  expect(deps.runNative).not.toHaveBeenCalled();
});

test('fails before inspection or migration when pgvector cannot be prepared', async () => {
  const deps = dependencies();
  deps.prepareDatabase.mockRejectedValue(new Error('pgvector unavailable'));

  await expect(
    deployFreshDatabase('postgresql://empty-target/example', deps),
  ).rejects.toThrow('pgvector unavailable');
  expect(deps.inspectCatalog).not.toHaveBeenCalled();
  expect(deps.runNative).not.toHaveBeenCalled();
});

test.each([
  undefined,
  null,
  {},
  { publicSchemaExists: true, applicationTables: [], applicationObjects: [], appliedMigrations: [] },
  { applicationTables: [], applicationObjects: [], appliedMigrations: undefined },
  { applicationTables: 'Document', applicationObjects: [], appliedMigrations: [] },
  {
    publicSchemaExists: false,
    prismaMigrationsRelationExists: false,
    applicationTables: [],
    applicationObjects: [],
    appliedMigrations: [],
  },
  { publicSchemaExists: true, prismaMigrationsRelationExists: false, applicationTables: [], appliedMigrations: [] },
  {
    publicSchemaExists: true,
    prismaMigrationsRelationExists: false,
    applicationTables: [],
    applicationObjects: 'view:report',
    appliedMigrations: [],
  },
])('fails closed when catalog inspection is ambiguous: %p', async (inspection) => {
  const deps = dependencies();
  deps.inspectCatalog.mockResolvedValue(inspection);

  await expect(
    deployFreshDatabase('postgresql://ambiguous/example', deps),
  ).rejects.toThrow('Catalog inspection returned an ambiguous result');
  expect(deps.runNative).not.toHaveBeenCalled();
});

test('requires an explicit target URL before catalog inspection', async () => {
  const deps = dependencies();

  await expect(deployFreshDatabase('', deps)).rejects.toThrow('DATABASE_URL is required');
  expect(deps.inspectCatalog).not.toHaveBeenCalled();
  expect(deps.prepareDatabase).not.toHaveBeenCalled();
  expect(deps.runNative).not.toHaveBeenCalled();
});

test('refuses a target URL configured for a non-public Prisma schema', async () => {
  const deps = dependencies();

  await expect(
    deployFreshDatabase('postgresql://empty-target/example?schema=managed', deps),
  ).rejects.toThrow('Target DATABASE_URL must use the public schema');
  expect(deps.inspectCatalog).not.toHaveBeenCalled();
  expect(deps.prepareDatabase).not.toHaveBeenCalled();
  expect(deps.runNative).not.toHaveBeenCalled();
});

test.each([
  'postgresql://empty-target/example?schema=public&schema=public',
  'postgresql://empty-target/example?schema=public&schema=managed',
])('refuses duplicate schema parameters before catalog inspection or native execution: %s', async (databaseUrl) => {
  const deps = dependencies();

  await expect(
    deployFreshDatabase(databaseUrl, deps),
  ).rejects.toThrow('Target DATABASE_URL must specify public schema exactly once or omit schema');
  expect(deps.inspectCatalog).not.toHaveBeenCalled();
  expect(deps.prepareDatabase).not.toHaveBeenCalled();
  expect(deps.runNative).not.toHaveBeenCalled();
});
