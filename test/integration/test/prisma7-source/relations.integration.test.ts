/**
 * The Prisma 7 contract source's relations verify against the database Prisma
 * 7.10.0 built (`fixtures/prisma7-source/supported/migration.sql`): every foreign
 * key, every implicit junction table with its columns, primary key, and
 * `_B_index`, with zero findings on those paths. Findings on other paths come
 * from constructs the source does not interpret yet (see
 * `fixtures/prisma7-source/relations/README.md`) and are filtered out.
 */
import { readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Schema } from '@internal/sql-contract-prisma7/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';

const fixturesDir = join(dirname(new URL(import.meta.url).pathname), '../fixtures/prisma7-source');
const migrationSql = readFileSync(join(fixturesDir, 'supported/migration.sql'), 'utf8');
const schemaPath = join(fixturesDir, 'relations/schema.prisma');

function sourceContext() {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  };
}

function isRelationPath(path: readonly string[]): boolean {
  const table = path[2] ?? '';
  const leaf = path[path.length - 1] ?? '';
  return (
    table.startsWith('_') ||
    leaf.startsWith('foreign-key:') ||
    leaf === 'primary-key' ||
    leaf.endsWith('_B_index')
  );
}

describe('Prisma 7 relations against the database Prisma 7 built', () => {
  it(
    'verifies every foreign key and implicit junction table with zero findings',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, (client) => client.query(migrationSql));

        const config = prisma7Schema(schemaPath, {
          target: postgresPackRef,
          createNamespace: postgresCreateNamespace,
          nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
        });
        const loaded = await config.source.load(sourceContext());
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;

        const serialized = new PostgresContractSerializer().serializeContract(
          loaded.value as Contract<SqlStorage>,
        );
        const result = await runSchemaVerify(connectionString, serialized);
        const paths = result.schema.issues.map((issue) => issue.path);
        const relationPaths = paths.filter(isRelationPath);
        expect(relationPaths).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
