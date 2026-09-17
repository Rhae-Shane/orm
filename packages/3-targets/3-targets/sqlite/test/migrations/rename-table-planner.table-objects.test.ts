/**
 * `--rename-table` on a SQLite table that carries indexes, constraints and foreign keys.
 *
 * SQLite renames a table's automatic indexes and rewrites foreign keys that reference it, and it names no primary key, unique or foreign key the contract leaves unnamed, so those need nothing beyond the rename. A wire-named index whose prefix derives from the table name keeps its old name through `ALTER TABLE ... RENAME TO`, and SQLite cannot rename an index, so it is dropped and created under the new name; an index holds no rows, so nothing is lost.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type ForeignKeyInput,
  type IndexInput,
  SqlStorage,
  StorageTable,
  type UniqueConstraintInput,
} from '@internal/sql-contract/types';
import { computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const integer = { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false };
const text = { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false };

interface ProfileSpec {
  readonly uniques?: readonly UniqueConstraintInput[];
  readonly foreignKeys?: (tableName: string) => readonly ForeignKeyInput[];
  readonly indexes?: (tableName: string) => readonly IndexInput[];
}

function reference(tableName: string, columns: readonly string[]) {
  return { namespaceId: UNBOUND_NAMESPACE_ID, tableName, columns };
}

function contractOf(
  profileTableName: string,
  spec: ProfileSpec,
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
            table: {
              [profileTableName]: new StorageTable({
                columns: { id: integer, email: text, handle: text, accountId: integer },
                primaryKey: { columns: ['id'] },
                uniques: spec.uniques ?? [],
                indexes: spec.indexes?.(profileTableName) ?? [],
                foreignKeys: spec.foreignKeys?.(profileTableName) ?? [],
              }),
              account: new StorageTable({
                columns: { id: integer },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
              post: new StorageTable({
                columns: { id: integer, profileId: integer },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: reference('post', ['profileId']),
                    target: reference(profileTableName, ['id']),
                  },
                ],
              }),
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

async function plannedLabels(spec: ProfileSpec): Promise<readonly string[]> {
  const from = contractOf('userProfile', spec, 'from');
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: contractOf('UserProfile', spec, 'to'),
    schema: sqliteContractToSchema(from),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    renames: [{ from: { name: 'userProfile' }, to: { name: 'UserProfile' } }],
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  return (await Promise.all(result.plan.operations)).map((op) => op.label);
}

const RENAME_TABLE = 'Rename table userProfile to UserProfile';

describe('SQLite planner rename-table intents with table objects', () => {
  it('drops an index whose prefix derives from the table name before creating it under the new name', async () => {
    const hash = computeIndexContentHash({ columns: ['handle'], unique: false });
    const handleIndex = (tableName: string): IndexInput => ({
      columns: ['handle'],
      naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash },
      where: undefined,
      unique: false,
      type: undefined,
      options: undefined,
    });

    expect(await plannedLabels({ indexes: (t) => [handleIndex(t)] })).toEqual([
      RENAME_TABLE,
      `Drop index userProfile_handle_idx_${hash} on UserProfile`,
      `Create index UserProfile_handle_idx_${hash} on UserProfile`,
    ]);
  });

  it('plans the rename alone for an unnamed unique, an owned foreign key and a referencing foreign key', async () => {
    expect(
      await plannedLabels({
        uniques: [{ columns: ['email'] }],
        foreignKeys: (tableName) => [
          { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
        ],
      }),
    ).toEqual([RENAME_TABLE]);
  });
});
