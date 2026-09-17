/**
 * Guard for the release that made a model with no `@@map` name its table
 * verbatim (`model UserProfile` -> table `UserProfile`, previously
 * `userProfile`). A schema upgraded without the codemod would plan a drop of
 * `userProfile` and a create of `UserProfile`, losing the table's rows. The
 * planner refuses that shape and tells the user how to keep the table.
 *
 * Removal condition: delete this guard and this test once the release that
 * introduced the verbatim default is no longer within the supported upgrade
 * window.
 */

import { type Contract, type ControlPolicy, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID, type StorageEntityRename } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresResolveDefault } from '../../src/core/default-normalizer';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { type PostgresContract, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresRenderDefault } from '../../src/exports/control';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

const DESTRUCTIVE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

interface ContractOptions {
  readonly namespaceId?: string;
  readonly extraColumn?: string;
  readonly control?: ControlPolicy;
  readonly extraTables?: readonly string[];
}

function storageTable(
  extraColumn: string | undefined,
  control: ControlPolicy | undefined,
  tableName: string,
) {
  return new StorageTable({
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      ...(extraColumn === undefined
        ? {}
        : { [extraColumn]: { nativeType: 'text', codecId: 'pg/text@1', nullable: true } }),
    },
    primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...(control === undefined ? {} : { control }),
  });
}

function contractWithTable(
  tableName: string,
  {
    namespaceId = UNBOUND_NAMESPACE_ID,
    extraColumn,
    control,
    extraTables = [],
  }: ContractOptions = {},
): Contract<SqlStorage> {
  const schema = postgresCreateNamespace({
    id: namespaceId,
    entries: {
      table: {
        [tableName]: storageTable(extraColumn, control, tableName),
        ...Object.fromEntries(
          extraTables.map((name) => [name, storageTable(undefined, undefined, name)]),
        ),
      },
      policy: {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('table-name-case-guard-test'),
    storage: new SqlStorage({
      storageHash: coreHash('table-name-case-guard-test'),
      namespaces: { [namespaceId]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveTable(tableName: string): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: tableName,
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false },
      email: { name: 'email', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function liveSchema(
  tableNames: readonly string[],
  schemaName = 'public',
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      [schemaName]: new PostgresNamespaceSchemaNode({
        schemaName,
        tables: Object.fromEntries(tableNames.map((name) => [name, liveTable(name)])),
      }),
    },
    roles: [],
    existingSchemas: [schemaName],
    pgVersion: 'unknown',
  });
}

function planFromLive(
  previousTables: readonly string[],
  nextTable: string,
  options: ContractOptions & { readonly schemaName?: string } = {},
) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  return () =>
    planner.plan({
      contract: contractWithTable(nextTable, options),
      schema: liveSchema(previousTables, options.schemaName),
      policy: DESTRUCTIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
}

describe('Postgres planner table-name case guard', () => {
  it('refuses to drop userProfile and create UserProfile', () => {
    const result = planFromLive(['userProfile'], 'UserProfile')();

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'tableNameCaseChanged',
        summary: expect.stringContaining('UserProfile'),
        why: expect.stringContaining('@@map("userProfile")'),
        meta: expect.objectContaining({ code: 'MIGRATION.TABLE_NAME_CASE_CHANGED' }),
      }),
    ]);
    expect(result.conflicts[0]?.summary).toContain('MIGRATION.TABLE_NAME_CASE_CHANGED');
    expect(result.conflicts[0]?.why).toContain(
      'in a project with migration history, state the rename when planning: prisma migration plan --rename "userProfile=UserProfile" (either side may be <schema>.<name>), and the plan renames the table and the objects named after it instead of dropping and recreating the table;',
    );
    expect(result.conflicts[0]?.why).not.toContain('one renameTable operation');
    expect(result.conflicts[0]?.why).toContain(
      'in a project that uses db update, rename it by hand with ALTER TABLE "userProfile" RENAME TO "UserProfile", then run db update again.',
    );
  });

  it('still refuses when UserProfile also gained a column', () => {
    const result = planFromLive(['userProfile'], 'UserProfile', { extraColumn: 'nickname' })();

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableNameCaseChanged']);
  });

  it('fires in a non-default schema', () => {
    const result = planFromLive(['userProfile'], 'UserProfile', {
      namespaceId: 'auth',
      schemaName: 'auth',
    })();

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts[0]?.location).toEqual({
      namespaceId: 'auth',
      entityKind: 'table',
      entityName: 'UserProfile',
    });
    expect(result.conflicts[0]?.why).toContain(
      'rename it by hand with ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile", then run db update again.',
    );
  });

  it('plans nothing once the model maps back to userProfile', async () => {
    const result = planFromLive(['userProfile'], 'userProfile')();

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(await Promise.all(result.plan.operations)).toEqual([]);
  });

  it('plans a plain create against an empty database', async () => {
    const result = planFromLive([], 'UserProfile')();

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(ids).toContain('table.UserProfile');
    expect(ids.some((id) => id.startsWith('dropTable.'))).toBe(false);
  });

  it('ignores a pair whose new table the control policy keeps the planner away from', async () => {
    const result = planFromLive(['userProfile'], 'UserProfile', {
      control: 'external',
      extraTables: ['Accounts'],
    })();

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(ids).toContain('table.Accounts');
    expect(ids).not.toContain('table.UserProfile');
  });

  it('plans a normal drop and create when the new table name is unrelated', async () => {
    const result = planFromLive(['userProfile'], 'Accounts')();

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const ids = ops.map((op) => op.id);
    expect(ids).toContain('dropTable.userProfile');
    expect(ids).toContain('table.Accounts');
  });
});

function namespacedContract(
  tablesByNamespace: Readonly<Record<string, string>>,
  hashSeed: string,
): PostgresContract {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: Object.fromEntries(
        Object.entries(tablesByNamespace).map(([namespaceId, tableName]) => [
          namespaceId,
          postgresCreateNamespace({
            id: namespaceId,
            entries: {
              table: { [tableName]: storageTable(undefined, undefined, tableName) },
              policy: {},
            },
          }),
        ]),
      ),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function planMigration(
  from: PostgresContract,
  to: PostgresContract,
  renames: readonly StorageEntityRename[] = [],
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: contractToPostgresDatabaseSchemaNode(from, {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
      resolveDefault: postgresResolveDefault,
    }),
    policy: DESTRUCTIVE_POLICY,
    fromContract: from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(renames.length === 0 ? {} : { renames }),
  });
}

function suggestedRenameFlag(why: string | undefined): string | undefined {
  return /prisma migration plan --rename "([^"]+)"/.exec(why ?? '')?.[1];
}

function coordinate(side: string): StorageEntityRename['from'] {
  const dot = side.indexOf('.');
  return dot === -1
    ? { name: side }
    : { namespaceId: side.slice(0, dot), name: side.slice(dot + 1) };
}

function renameFromFlag(flag: string): StorageEntityRename {
  const [from = '', to = ''] = flag.split('=');
  return { from: coordinate(from), to: coordinate(to) };
}

describe('the --rename the Postgres case guard suggests', () => {
  async function planWithSuggestion(from: PostgresContract, to: PostgresContract) {
    const refused = planMigration(from, to);
    expect(refused.kind).toBe('failure');
    if (refused.kind !== 'failure') throw new Error('the case guard did not refuse');
    const flag = suggestedRenameFlag(refused.conflicts[0]?.why);
    if (flag === undefined) throw new Error('the case guard suggested no --rename');
    const renamed = planMigration(from, to, [renameFromFlag(flag)]);
    expect(
      renamed.kind === 'failure' ? renamed.conflicts.map((conflict) => conflict.summary) : [],
    ).toEqual([]);
    if (renamed.kind !== 'success') throw new Error('planning with the suggestion failed');
    const statements = (await Promise.all(renamed.plan.operations)).map((op) =>
      op.execute.map((step) => step.sql),
    );
    return { flag, statements };
  }

  it('names the namespace when another namespace declares the old table name, and planning with it renames the table', async () => {
    const result = await planWithSuggestion(
      namespacedContract({ public: 'userProfile', auth: 'userProfile' }, 'two-namespaces-from'),
      namespacedContract({ public: 'UserProfile', auth: 'userProfile' }, 'two-namespaces-to'),
    );

    expect(result).toEqual({
      flag: 'public.userProfile=public.UserProfile',
      statements: [['ALTER TABLE "public"."userProfile" RENAME TO "UserProfile"']],
    });
  });

  it('names the namespace when the table is not in the default namespace', async () => {
    const result = await planWithSuggestion(
      namespacedContract({ auth: 'userProfile' }, 'auth-from'),
      namespacedContract({ auth: 'UserProfile' }, 'auth-to'),
    );

    expect(result).toEqual({
      flag: 'auth.userProfile=auth.UserProfile',
      statements: [['ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"']],
    });
  });

  it('stays unqualified for a table of the default namespace whose name no other namespace declares', async () => {
    const result = await planWithSuggestion(
      namespacedContract({ public: 'userProfile', auth: 'account' }, 'public-from'),
      namespacedContract({ public: 'UserProfile', auth: 'account' }, 'public-to'),
    );

    expect(result).toEqual({
      flag: 'userProfile=UserProfile',
      statements: [['ALTER TABLE "public"."userProfile" RENAME TO "UserProfile"']],
    });
  });
});
