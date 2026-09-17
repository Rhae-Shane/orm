/**
 * `--rename-table` on a Postgres table that carries indexes, constraints and foreign keys.
 *
 * Wire-named indexes and checks whose prefix derives from the table name pair by content hash and plan as renames. Primary keys, uniques and foreign keys the contract leaves unnamed were named by the planner from the old table name, so each gets a companion constraint rename to the name the planner now derives from the new table name. Explicitly named constraints keep their names, and foreign keys on other tables keep theirs.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type CheckConstraintInput,
  type ForeignKeyInput,
  type IndexInput,
  type PrimaryKeyInput,
  SqlStorage,
  StorageTable,
  type UniqueConstraintInput,
} from '@internal/sql-contract/types';
import { computeCheckContentHash, computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const text = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };
const int4 = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
const NICKNAME_CHECK = 'length(nickname) > 0';

interface ProfileSpec {
  readonly primaryKey?: PrimaryKeyInput;
  readonly uniques?: readonly UniqueConstraintInput[];
  readonly foreignKeys?: (tableName: string) => readonly ForeignKeyInput[];
  readonly indexes?: (tableName: string) => readonly IndexInput[];
  readonly checks?: (tableName: string) => readonly CheckConstraintInput[];
}

function profileTable(tableName: string, spec: ProfileSpec): StorageTable {
  return new StorageTable({
    columns: { id: int4, email: text, handle: text, nickname: text, accountId: int4 },
    primaryKey: spec.primaryKey ?? { columns: ['id'], name: 'profile_pk' },
    uniques: spec.uniques ?? [],
    indexes: spec.indexes?.(tableName) ?? [],
    foreignKeys: spec.foreignKeys?.(tableName) ?? [],
    checks: spec.checks?.(tableName) ?? [],
  });
}

function reference(tableName: string, columns: readonly string[]) {
  return { namespaceId: UNBOUND_NAMESPACE_ID, tableName, columns };
}

const accountTable = new StorageTable({
  columns: { id: int4 },
  primaryKey: { columns: ['id'], name: 'account_pk' },
  uniques: [],
  indexes: [],
  foreignKeys: [],
});

function postTable(profileTableName: string): StorageTable {
  return new StorageTable({
    columns: { id: int4, profileId: int4 },
    primaryKey: { columns: ['id'], name: 'post_pk' },
    uniques: [],
    indexes: [],
    foreignKeys: [
      {
        source: reference('post', ['profileId']),
        target: reference(profileTableName, ['id']),
      },
    ],
  });
}

function contractOf(
  profileTableName: string,
  spec: ProfileSpec,
  hashSeed: string,
  extraTables: (profileTableName: string) => Record<string, StorageTable> = () => ({}),
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [profileTableName]: profileTable(profileTableName, spec),
              account: accountTable,
              ...extraTables(profileTableName),
            },
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

async function plannedOps(from: Contract<SqlStorage>, to: Contract<SqlStorage>) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, []),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    renames: [{ from: { name: 'userProfile' }, to: { name: 'UserProfile' } }],
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  return Promise.all(result.plan.operations);
}

async function plannedSql(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
): Promise<readonly (readonly string[])[]> {
  return (await plannedOps(from, to)).map((op) => op.execute.map((step) => step.sql));
}

async function planRename(spec: ProfileSpec, nextSpec: ProfileSpec = spec) {
  return plannedSql(
    contractOf('userProfile', spec, 'from'),
    contractOf('UserProfile', nextSpec, 'to'),
  );
}

const RENAME_TABLE = ['ALTER TABLE "userProfile" RENAME TO "UserProfile"'];

describe('Postgres planner rename-table intents with table objects', () => {
  describe('wire-named indexes and checks', () => {
    it('renames an index whose prefix derives from the table name', async () => {
      const hash = computeIndexContentHash({ columns: ['handle'], unique: false });
      const handleIndex = (tableName: string): IndexInput => ({
        columns: ['handle'],
        naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash },
        where: undefined,
        unique: false,
        type: undefined,
        options: undefined,
      });

      const ops = await plannedOps(
        contractOf('userProfile', { indexes: (t) => [handleIndex(t)] }, 'from'),
        contractOf('UserProfile', { indexes: (t) => [handleIndex(t)] }, 'to'),
      );

      expect(ops.map((op) => op.label)).toEqual([
        'Rename table "userProfile" to "UserProfile"',
        `Rename index "userProfile_handle_idx_${hash}" to "UserProfile_handle_idx_${hash}" on "UserProfile"`,
      ]);
    });

    it('renames a check constraint whose prefix derives from the table name', async () => {
      const hash = computeCheckContentHash(NICKNAME_CHECK);
      const nicknameCheck = (tableName: string): CheckConstraintInput => ({
        naming: { kind: 'wire', prefix: `${tableName}_nickname_check`, hash },
        expression: NICKNAME_CHECK,
      });

      expect(await planRename({ checks: (t) => [nicknameCheck(t)] })).toEqual([
        RENAME_TABLE,
        [
          `ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_nickname_check_${hash}" TO "UserProfile_nickname_check_${hash}"`,
        ],
      ]);
    });

    it('plans nothing for a foreign key on another table that references the renamed table', async () => {
      expect(
        await plannedSql(
          contractOf('userProfile', {}, 'from', (t) => ({ post: postTable(t) })),
          contractOf('UserProfile', {}, 'to', (t) => ({ post: postTable(t) })),
        ),
      ).toEqual([RENAME_TABLE]);
    });
  });

  describe('constraints the contract leaves unnamed', () => {
    it('renames the primary key the planner named after the old table', async () => {
      expect(await planRename({ primaryKey: { columns: ['id'] } })).toEqual([
        RENAME_TABLE,
        ['ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_pkey" TO "UserProfile_pkey"'],
      ]);
    });

    it('renames an unnamed unique constraint', async () => {
      expect(await planRename({ uniques: [{ columns: ['email'] }] })).toEqual([
        RENAME_TABLE,
        [
          'ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_email_key" TO "UserProfile_email_key"',
        ],
      ]);
    });

    it('renames an unnamed foreign key the renamed table owns', async () => {
      const accountFk = (tableName: string): ForeignKeyInput => ({
        source: reference(tableName, ['accountId']),
        target: reference('account', ['id']),
      });

      expect(await planRename({ foreignKeys: (t) => [accountFk(t)] })).toEqual([
        RENAME_TABLE,
        [
          'ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_accountId_fkey" TO "UserProfile_accountId_fkey"',
        ],
      ]);
    });

    it('renames the unique first, so dropping it in the same plan uses the new name', async () => {
      expect(await planRename({ uniques: [{ columns: ['email'] }] }, {})).toEqual([
        RENAME_TABLE,
        [
          'ALTER TABLE "UserProfile" RENAME CONSTRAINT "userProfile_email_key" TO "UserProfile_email_key"',
        ],
        ['ALTER TABLE "UserProfile" DROP CONSTRAINT "UserProfile_email_key"'],
      ]);
    });
  });

  describe('constraints with explicit names', () => {
    it('keeps explicitly named primary keys, uniques and foreign keys', async () => {
      const spec: ProfileSpec = {
        primaryKey: { columns: ['id'], name: 'profile_pk' },
        uniques: [{ columns: ['email'], name: 'profile_email_unique' }],
        foreignKeys: (tableName) => [
          {
            source: reference(tableName, ['accountId']),
            target: reference('account', ['id']),
            name: 'profile_account_fk',
          },
        ],
      };

      expect(await planRename(spec)).toEqual([RENAME_TABLE]);
    });

    it('keeps the old name of an unnamed unique that the next contract names explicitly', async () => {
      expect(
        await planRename(
          { uniques: [{ columns: ['email'] }] },
          { uniques: [{ columns: ['email'], name: 'userProfile_email_key' }] },
        ),
      ).toEqual([RENAME_TABLE]);
    });
  });
});
