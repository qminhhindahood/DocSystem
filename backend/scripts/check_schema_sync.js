const fs = require('fs');
const path = require('path');

const prismaSchemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const migrationsPath = path.join(__dirname, '..', 'prisma', 'migrations');

if (!fs.existsSync(prismaSchemaPath)) {
  console.error(`Error: Could not find schema.prisma at ${prismaSchemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(migrationsPath)) {
  console.error(`Error: Could not find Prisma migrations at ${migrationsPath}`);
  process.exit(1);
}

const prismaContent = fs.readFileSync(prismaSchemaPath, 'utf8');
const migrationFiles = fs.readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationsPath, entry.name, 'migration.sql'))
  .filter((file) => fs.existsSync(file));

if (migrationFiles.length === 0) {
  console.error('Error: Prisma migration history contains no migration.sql files');
  process.exit(1);
}

const sqlContent = migrationFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

// Extract all models from schema.prisma
const prismaModels = [];
const modelRegex = /^model\s+(\w+)\s+{/gm;
let match;
while ((match = modelRegex.exec(prismaContent)) !== null) {
  prismaModels.push(match[1]);
}

// Extract all tables created across the immutable Prisma migration history.
const sqlTables = [];
const tableRegex = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"(\w+)"/g;
while ((match = tableRegex.exec(sqlContent)) !== null) {
  sqlTables.push(match[1]);
}

// Compare
let driftDetected = false;

for (const model of prismaModels) {
  if (!sqlTables.includes(model)) {
    console.error(`❌ Schema Drift Detected: Model "${model}" is not created by Prisma migration history`);
    driftDetected = true;
  }
}

for (const table of sqlTables) {
  if (!prismaModels.includes(table)) {
    console.error(`❌ Schema Drift Detected: Migrated table "${table}" has no model in schema.prisma`);
    driftDetected = true;
  }
}

if (driftDetected) {
  console.error('\nFailure: schema.prisma and Prisma migration history are out of sync.');
  process.exit(1);
} else {
  console.log('✅ Success: schema.prisma models are covered by Prisma migration history.');
  process.exit(0);
}
