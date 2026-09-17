/**
 * `migration new --rename` on Postgres: the scaffold carries the same rename operations `migration plan` plans for the stated renames, and refuses the intents `migration plan` refuses.
 */

import type { Contract } from '@internal/contract/types';
import type {
  MigrationPlanWithAuthoringSurface,
  StorageEntityRename,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import type { IndexInput, SqlStorage } from '@internal/sql-contract/types';
import { computeIndexContentHash } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { contractOf, type ProfileSpec, reference, stubLowerer } from './rename-table-fixtures';

const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);
const RENAME: StorageEntityRename = { from: { name: 'userProfile' }, to: { name: 'UserProfile' } };
const HANDLE_HASH = computeIndexContentHash({ columns: ['handle'], unique: false });

const withObjects: ProfileSpec = {
  primaryKey: { columns: ['id'] },
  uniques: [{ columns: ['email'] }],
  foreignKeys: (tableName) => [
    { source: reference(tableName, ['accountId']), target: reference('account', ['id']) },
  ],
  indexes: (tableName): readonly IndexInput[] => [
    {
      columns: ['handle'],
      naming: { kind: 'wire', prefix: `${tableName}_handle_idx`, hash: HANDLE_HASH },
      where: undefined,
      unique: false,
      type: undefined,
      options: undefined,
    },
  ],
};

function scaffold(input: {
  readonly from: Contract<SqlStorage> | null;
  readonly to: Contract<SqlStorage>;
  readonly intents?: readonly StorageEntityRename[];
}) {
  return createPostgresMigrationPlanner(stubLowerer).emptyMigration(
    {
      packageDir: '/tmp/migration-pkg',
      fromHash: input.from?.storage.storageHash ?? null,
      toHash: input.to.storage.storageHash,
      snapshotsImportPath: '../../snapshots',
      renames: {
        intents: input.intents ?? [RENAME],
        fromContract: input.from,
        toContract: input.to,
        frameworkComponents: [],
      },
    },
    APP_SPACE_ID,
  );
}

async function labelsOf(plan: MigrationPlanWithAuthoringSurface): Promise<readonly string[]> {
  return (await Promise.all(plan.operations)).map((op) => op.label);
}

const RENAME_LABELS = [
  'Rename table "userProfile" to "UserProfile"',
  'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
  'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
  'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
  `Rename index "userProfile_handle_idx_${HANDLE_HASH}" to "UserProfile_handle_idx_${HANDLE_HASH}" on "UserProfile"`,
];

describe('Postgres scaffold rename-table intents', () => {
  it('carries the same operations migration plan plans for the rename', async () => {
    const from = contractOf('userProfile', withObjects, FROM_HASH);
    const to = contractOf('UserProfile', withObjects, TO_HASH);
    const planned = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: postgresContractToSchema(from, []),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: from,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      renames: [RENAME],
    });
    expect(planned.kind).toBe('success');
    if (planned.kind !== 'success') return;

    expect(await labelsOf(scaffold({ from, to }))).toEqual(RENAME_LABELS);
    expect(await labelsOf(planned.plan)).toEqual(RENAME_LABELS);
  });

  it('carries only the renames, not the other changes between the contracts', async () => {
    const from = contractOf('userProfile', withObjects, FROM_HASH);
    const to = contractOf(
      'UserProfile',
      { ...withObjects, uniques: [{ columns: ['email'] }, { columns: ['handle'] }] },
      TO_HASH,
    );

    expect(await labelsOf(scaffold({ from, to }))).toEqual(RENAME_LABELS);
  });

  it('renders every rename as a facade call', () => {
    const source = scaffold({
      from: contractOf('userProfile', withObjects, FROM_HASH),
      to: contractOf('UserProfile', withObjects, TO_HASH),
    }).renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain('this.renameTable({ table: "userProfile", to: "UserProfile" })');
    expect(source).toContain(
      'this.renameConstraint({ table: "UserProfile", kind: "unique", from: "userProfile_email_key", to: "UserProfile_email_key" })',
    );
  });

  it('renames in the schema that declares the table', () => {
    const source = scaffold({
      from: contractOf('userProfile', {}, FROM_HASH, () => ({}), 'auth'),
      to: contractOf('UserProfile', {}, TO_HASH, () => ({}), 'auth'),
    }).renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain(
      'this.renameTable({ schema: "auth", table: "userProfile", to: "UserProfile" })',
    );
  });

  it('refuses with MIGRATION.TABLE_RENAME_NO_PREVIOUS_CONTRACT when there is no previous contract', () => {
    expect(() => scaffold({ from: null, to: contractOf('UserProfile', {}, TO_HASH) })).toThrow(
      expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_NO_PREVIOUS_CONTRACT' }),
    );
  });

  it('refuses an intent that matches neither contract with MIGRATION.TABLE_RENAME_UNMATCHED', () => {
    expect(() =>
      scaffold({
        from: contractOf('userProfile', {}, FROM_HASH),
        to: contractOf('UserProfile', {}, TO_HASH),
        intents: [{ from: { name: 'ghost' }, to: { name: 'UserProfile' } }],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: expect.stringContaining('table "ghost" does not exist in the previous contract'),
      }),
    );
  });

  it('scaffolds an empty body without renames', () => {
    const empty = createPostgresMigrationPlanner(stubLowerer).emptyMigration(
      {
        packageDir: '/tmp/migration-pkg',
        fromHash: null,
        toHash: TO_HASH,
        snapshotsImportPath: '../../snapshots',
      },
      APP_SPACE_ID,
    );

    expect(empty.operations).toEqual([]);
  });
});
