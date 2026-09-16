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
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

const DESTRUCTIVE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function contractWithTable(tableName: string): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('table-name-case-guard-test'),
    storage: new SqlStorage({
      storageHash: coreHash('table-name-case-guard-test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [tableName]: {
                columns: {
                  id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveSchemaWithTable(tableName: string): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      [tableName]: {
        name: tableName,
        columns: {
          id: { name: 'id', nativeType: 'integer', nullable: false },
          email: { name: 'email', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
  });
}

function planFromLive(previousTable: string, nextTable: string) {
  const planner = createSqliteMigrationPlanner(stubLowerer);
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

describe('SQLite planner table-name case guard', () => {
  it('refuses to drop userProfile and create UserProfile with the same columns', () => {
    const plan = planFromLive('userProfile', 'UserProfile');

    expect(plan).toThrow();
    let thrown: unknown;
    try {
      plan();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'MIGRATION.TABLE_NAME_CASE_CHANGED' });
    expect(thrown).toMatchObject({ message: expect.stringContaining('UserProfile') });
    expect(thrown).toMatchObject({ message: expect.stringContaining('@@map("userProfile")') });
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
