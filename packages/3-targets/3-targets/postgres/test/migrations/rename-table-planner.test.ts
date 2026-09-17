/**
 * `--rename-table` intents on the Postgres planner: the stated tables are
 * renamed in the previous contract before the diff, one `renameTable` op is
 * prepended per intent, and an intent that matches neither side is a
 * planning failure rather than a warning.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  MigrationOperationClass,
  StorageEntityRename,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresResolveDefault } from '../../src/core/default-normalizer';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { type PostgresContract, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresRenderDefault } from '../../src/exports/control';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES = ['additive', 'widening', 'destructive'] as const;
const ADDITIVE_ONLY = ['additive'] as const;

interface TableSpec {
  readonly extraColumn?: string;
}

function storageTable(spec: TableSpec, tableName: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      ...(spec.extraColumn === undefined
        ? {}
        : { [spec.extraColumn]: { nativeType: 'text', codecId: 'pg/text@1', nullable: true } }),
    },
    primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  });
}

function contractOf(
  tables: Readonly<Record<string, TableSpec>>,
  hashSeed: string,
  namespaceId: string = UNBOUND_NAMESPACE_ID,
): PostgresContract {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [namespaceId]: postgresCreateNamespace({
          id: namespaceId,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([name, spec]) => [name, storageTable(spec, name)]),
            ),
            policy: {},
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

function schemaOf(contract: Contract<SqlStorage> | null) {
  return contractToPostgresDatabaseSchemaNode(
    contract === null ? null : { ...contract, target: 'postgres' as const },
    {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
      resolveDefault: postgresResolveDefault,
    },
  );
}

function plan(input: {
  readonly from: PostgresContract | null;
  readonly to: PostgresContract;
  readonly renames?: readonly StorageEntityRename[];
  readonly policy?: readonly MigrationOperationClass[];
}) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  return planner.plan({
    contract: input.to,
    schema: schemaOf(input.from),
    policy: { allowedOperationClasses: [...(input.policy ?? ALL_CLASSES)] },
    fromContract: input.from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(input.renames === undefined ? {} : { renames: input.renames }),
  });
}

const rename = (from: string, to: string): StorageEntityRename => ({
  from: { name: from },
  to: { name: to },
});

describe('Postgres planner rename-table intents', () => {
  it('plans exactly one rename op when the tables are otherwise identical', async () => {
    const from = contractOf({ userProfile: {} }, 'from');
    const to = contractOf({ UserProfile: {} }, 'to');

    const result = plan({ from, to, renames: [rename('userProfile', 'UserProfile')] });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual(['renameTable.userProfile']);
    expect(ops[0]?.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "UserProfile"',
    ]);
    expect(ops[0]?.operationClass).toBe('widening');
    expect(result.plan.describe()).toEqual({
      from: from.storage.storageHash,
      to: to.storage.storageHash,
    });
  });

  it('renders the rename as a facade call in the migration file', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ UserProfile: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.plan.renderTypeScript()).toContain(
      'this.renameTable({ table: "userProfile", to: "UserProfile" })',
    );
  });

  it('plans the rename first, then the added column on the new name', async () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ UserProfile: { extraColumn: 'nickname' } }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('renameTable.userProfile');
    expect(ids[1]).toMatch(/^column\..*UserProfile\.nickname$/);
  });

  it('qualifies the statement with the schema when the intent names a bound namespace', async () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from', 'auth'),
      to: contractOf({ UserProfile: {} }, 'to', 'auth'),
      renames: [
        { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      ],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.execute.map((step) => step.sql))).toEqual([
      ['ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"'],
    ]);
  });

  it('applies several intents, one rename op each, in the order given', async () => {
    const result = plan({
      from: contractOf({ userProfile: {}, orderLine: {} }, 'from'),
      to: contractOf({ UserProfile: {}, OrderLine: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile'), rename('orderLine', 'OrderLine')],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(ids).toEqual(['renameTable.userProfile', 'renameTable.orderLine']);
  });

  it('fails when the intent names a previous table that does not exist', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ UserProfile: {} }, 'to'),
      renames: [rename('ghost', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'tableRenameUnmatched',
        summary: expect.stringContaining('"ghost"'),
        meta: expect.objectContaining({
          code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
          from: 'ghost',
          to: 'UserProfile',
        }),
      }),
    ]);
  });

  it('fails when the new name already exists in the previous state', () => {
    const result = plan({
      from: contractOf({ userProfile: {}, UserProfile: {} }, 'from'),
      to: contractOf({ UserProfile: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableRenameUnmatched']);
    expect(result.conflicts[0]?.summary).toContain('already exists');
  });

  it('fails when the new name is absent from the next contract', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ Account: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableRenameUnmatched']);
    expect(result.conflicts[0]?.summary).toContain('"UserProfile"');
  });

  it('fails when intents are given without a prior contract to apply them to', () => {
    const result = plan({
      from: null,
      to: contractOf({ UserProfile: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['unsupportedOperation']);
  });

  it('still fires the case-change guard when the pair is not covered by an intent', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ UserProfile: {} }, 'to'),
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableNameCaseChanged']);
  });

  it('refuses the rename under an additive-only policy like any other widening op', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, 'from'),
      to: contractOf({ UserProfile: {} }, 'to'),
      renames: [rename('userProfile', 'UserProfile')],
      policy: ADDITIVE_ONLY,
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.summary)).toEqual([
      expect.stringContaining('requires class "widening"'),
    ]);
  });
});
