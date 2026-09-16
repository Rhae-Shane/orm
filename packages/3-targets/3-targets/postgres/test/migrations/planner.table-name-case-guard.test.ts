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

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

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

function contractWithTable(tableName: string): Contract<SqlStorage> {
  const schema = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        [tableName]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
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
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveSchemaWithTable(tableName: string): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [tableName]: new PostgresTableSchemaNode({
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
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

function planFromLive(previousTable: string, nextTable: string) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  return () =>
    planner.plan({
      contract: contractWithTable(nextTable),
      schema: liveSchemaWithTable(previousTable),
      policy: DESTRUCTIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
}

describe('Postgres planner table-name case guard', () => {
  it('refuses to drop userProfile and create UserProfile with the same columns', () => {
    const result = planFromLive('userProfile', 'UserProfile')();

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
  });

  it('plans a normal drop and create when the new table name is unrelated', async () => {
    const result = planFromLive('userProfile', 'Accounts')();

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const ids = ops.map((op) => op.id);
    expect(ids).toContain('dropTable.userProfile');
    expect(ids).toContain('table.Accounts');
  });
});
