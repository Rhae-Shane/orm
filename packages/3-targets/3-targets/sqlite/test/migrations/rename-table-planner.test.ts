/**
 * `--rename-table` intents on the SQLite planner: the stated tables are
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
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

const ALL_CLASSES = ['additive', 'widening', 'destructive'] as const;
const ADDITIVE_ONLY = ['additive'] as const;
const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);

interface TableSpec {
  readonly extraColumn?: string;
}

function storageTable(spec: TableSpec, tableName: string): StorageTable {
  return new StorageTable({
    columns: {
      id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
      email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
      ...(spec.extraColumn === undefined
        ? {}
        : {
            [spec.extraColumn]: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: true },
          }),
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
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([name, spec]) => [name, storageTable(spec, name)]),
            ),
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

function plan(input: {
  readonly from: Contract<SqlStorage> | null;
  readonly to: Contract<SqlStorage>;
  readonly renames?: readonly StorageEntityRename[];
  readonly policy?: readonly MigrationOperationClass[];
}) {
  const planner = createSqliteMigrationPlanner(stubLowerer);
  return planner.plan({
    contract: input.to,
    schema: sqliteContractToSchema(input.from),
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

describe('SQLite planner rename-table intents', () => {
  it('plans exactly one rename op when the tables are otherwise identical', async () => {
    const from = contractOf({ userProfile: {} }, FROM_HASH);
    const to = contractOf({ UserProfile: {} }, TO_HASH);

    const result = plan({ from, to, renames: [rename('userProfile', 'UserProfile')] });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual(['renameTable.userProfile']);
    expect(ops[0]?.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"',
      'ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"',
    ]);
    expect(ops[0]?.operationClass).toBe('widening');
    expect(result.plan.describe()).toEqual({
      from: from.storage.storageHash,
      to: to.storage.storageHash,
    });
  });

  it('renders the rename as a facade call in the migration file', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.plan.renderTypeScript(keepInternalSpecifiers)).toContain(
      'this.renameTable({ table: "userProfile", to: "UserProfile" })',
    );
  });

  it('plans the rename first, then the added column on the new name', async () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: { extraColumn: 'nickname' } }, TO_HASH),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ids = (await Promise.all(result.plan.operations)).map((op) => op.id);
    expect(ids).toEqual(['renameTable.userProfile', 'column.UserProfile.nickname']);
  });

  it('fails when the intent names a previous table that does not exist', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
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
      from: contractOf({ userProfile: {}, UserProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableRenameUnmatched']);
    expect(result.conflicts[0]?.summary).toContain('already exists');
  });

  it('fails when the new name is absent from the next contract', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ Account: {} }, TO_HASH),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableRenameUnmatched']);
  });

  it('fails when the intent is qualified with a namespace SQLite does not have', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
      renames: [
        { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      ],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableRenameUnmatched']);
  });

  it('fails when intents are given without a prior contract to apply them to', () => {
    const result = plan({
      from: null,
      to: contractOf({ UserProfile: {} }, TO_HASH),
      renames: [rename('userProfile', 'UserProfile')],
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['unsupportedOperation']);
  });

  it('still fires the case-change guard when the pair is not covered by an intent', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
    });

    expect(result.kind).toBe('failure');
    if (result.kind !== 'failure') return;
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['tableNameCaseChanged']);
  });

  it('refuses the rename under an additive-only policy like any other widening op', () => {
    const result = plan({
      from: contractOf({ userProfile: {} }, FROM_HASH),
      to: contractOf({ UserProfile: {} }, TO_HASH),
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
