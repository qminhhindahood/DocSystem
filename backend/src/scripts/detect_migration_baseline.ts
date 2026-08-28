import { PrismaClient } from '@prisma/client';
import {
  assessMigrationBaseline,
  type ColumnShape,
  type DatabaseShape,
  type KeyShape,
} from '../services/migration_baseline';

type WritableText = {
  write(text: string): unknown;
};

export type DetectorIo = {
  stdout: WritableText;
  stderr: WritableText;
};

export type BaselineInspector = {
  inspect(): Promise<DatabaseShape>;
  disconnect(): Promise<void>;
};

type TableRow = { tableName: string };
type ColumnRow = {
  tableName: string;
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: 'YES' | 'NO';
  columnDefault: string | null;
};
type IndexRow = {
  tableName: string;
  isPrimary: boolean;
  isUnique: boolean;
  columns: string[];
};
type ConstraintRow = {
  constraintType: 'f' | 'c';
  tableName: string;
  columns: string[];
  referencedTable: string | null;
  referencedColumns: string[] | null;
  definition: string;
};
type MigrationRow = { migrationName: string };

class PrismaBaselineInspector implements BaselineInspector {
  constructor(private readonly prisma: PrismaClient) {}

  async inspect(): Promise<DatabaseShape> {
    const tableRows = await this.prisma.$queryRaw<TableRow[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const tables = tableRows.map((row) => row.tableName);

    const columnRows = await this.prisma.$queryRaw<ColumnRow[]>`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        udt_name AS "udtName",
        is_nullable AS "isNullable",
        column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position
    `;

    const indexRows = await this.prisma.$queryRaw<IndexRow[]>`
      SELECT
        relation.relname AS "tableName",
        index_info.indisprimary AS "isPrimary",
        index_info.indisunique AS "isUnique",
        array_agg(attribute.attname ORDER BY indexed_column.ordinality)::text[] AS "columns"
      FROM pg_index AS index_info
      JOIN pg_class AS relation ON relation.oid = index_info.indrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN LATERAL unnest(index_info.indkey)
        WITH ORDINALITY AS indexed_column(attribute_number, ordinality) ON true
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attnum = indexed_column.attribute_number
      WHERE namespace.nspname = current_schema()
        AND (index_info.indisprimary OR index_info.indisunique)
      GROUP BY relation.relname, index_info.indexrelid, index_info.indisprimary, index_info.indisunique
      ORDER BY relation.relname, index_info.indexrelid
    `;

    const constraintRows = await this.prisma.$queryRaw<ConstraintRow[]>`
      SELECT
        constraint_info.contype::text AS "constraintType",
        relation.relname AS "tableName",
        ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_info.conkey)
            WITH ORDINALITY AS constrained_column(attribute_number, ordinality)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = relation.oid
           AND attribute.attnum = constrained_column.attribute_number
          ORDER BY constrained_column.ordinality
        )::text[] AS "columns",
        referenced_relation.relname AS "referencedTable",
        CASE WHEN constraint_info.confrelid = 0 THEN NULL ELSE ARRAY(
          SELECT referenced_attribute.attname
          FROM unnest(constraint_info.confkey)
            WITH ORDINALITY AS referenced_column(attribute_number, ordinality)
          JOIN pg_attribute AS referenced_attribute
            ON referenced_attribute.attrelid = referenced_relation.oid
           AND referenced_attribute.attnum = referenced_column.attribute_number
          ORDER BY referenced_column.ordinality
        )::text[] END AS "referencedColumns",
        pg_get_constraintdef(constraint_info.oid, true) AS "definition"
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_class AS referenced_relation ON referenced_relation.oid = constraint_info.confrelid
      WHERE namespace.nspname = current_schema()
        AND constraint_info.contype IN ('f', 'c')
      ORDER BY relation.relname, constraint_info.conname
    `;

    let appliedMigrationNames: string[] = [];
    if (tables.includes('_prisma_migrations')) {
      const migrationRows = await this.prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name AS "migrationName"
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        ORDER BY finished_at
      `;
      appliedMigrationNames = migrationRows.map((row) => row.migrationName);
    }

    const columns: ColumnShape[] = columnRows.map((row) => ({
      table: row.tableName,
      name: row.columnName,
      dataType: row.dataType,
      udtName: row.udtName,
      nullable: row.isNullable === 'YES',
      hasDefault: row.columnDefault !== null,
    }));
    const indexKeys: KeyShape[] = indexRows.map((row) => ({
      kind: row.isPrimary ? 'PRIMARY KEY' : 'UNIQUE',
      table: row.tableName,
      columns: row.columns,
    }));
    const constraintKeys: KeyShape[] = constraintRows.map((row) => ({
      kind: row.constraintType === 'f' ? 'FOREIGN KEY' : 'CHECK',
      table: row.tableName,
      columns: row.columns,
      referencedTable: row.referencedTable ?? undefined,
      referencedColumns: row.referencedColumns ?? undefined,
      definition: row.definition,
    }));

    return {
      tables,
      columns,
      keys: [...indexKeys, ...constraintKeys],
      appliedMigrationNames,
    };
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runBaselineDetector(
  inspector: BaselineInspector,
  io: DetectorIo = process,
): Promise<number> {
  try {
    const assessment = assessMigrationBaseline(await inspector.inspect());
    if (assessment.state === 'incompatible') {
      io.stderr.write('Existing database is not compatible with the standalone baseline.\n');
      for (const diagnostic of assessment.diagnostics) {
        io.stderr.write(`- ${diagnostic}\n`);
      }
      io.stderr.write('Back up the database before changing its schema. No database changes were made.\n');
      return 2;
    }
    io.stdout.write(`${assessment.state}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`Could not inspect the database migration baseline: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    try {
      await inspector.disconnect();
    } catch (error) {
      io.stderr.write(`Could not close the database connection: ${errorMessage(error)}\n`);
    }
  }
}

if (require.main === module) {
  const inspector = new PrismaBaselineInspector(new PrismaClient());
  void runBaselineDetector(inspector).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
