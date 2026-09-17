/**
 * `migration new --rename-table` on SQLite: the scaffold carries the same rename operations `migration plan` plans for the stated renames, and refuses the intents `migration plan` refuses, including a namespace qualifier SQLite does not have.
 */

import type { Contract } from '@internal/contract/types';
import type {
  MigrationPlanWithAuthoringSurface,
  StorageEntityRename,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  stubLowerer,
} from './rename-table-fixtures';

const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);
const RENAME: StorageEntityRename = { from: { name: 'userProfile' }, to: { name: 'UserProfile' } };
const withIndex: ProfileSpec = {
  uniques: [{ columns: ['email'] }],
  indexes: (t) => [handleIndex(t)],
};

function scaffold(input: {
  readonly from: Contract<SqlStorage> | null;
  readonly to: Contract<SqlStorage>;
  readonly intents?: readonly StorageEntityRename[];
}) {
  return createSqliteMigrationPlanner(stubLowerer).emptyMigration(
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
  'Rename table userProfile to UserProfile',
  `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
  `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
];

describe('SQLite scaffold rename-table intents', () => {
  it('carries the same operations migration plan plans for the rename', async () => {
    const from = contractOf('userProfile', withIndex, FROM_HASH);
    const to = contractOf('UserProfile', withIndex, TO_HASH);
    const planned = createSqliteMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: sqliteContractToSchema(from),
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
    const from = contractOf('userProfile', withIndex, FROM_HASH);
    const to = contractOf('UserProfile', { ...withIndex, uniques: [] }, TO_HASH);

    expect(await labelsOf(scaffold({ from, to }))).toEqual(RENAME_LABELS);
  });

  it('renders every rename as a facade call', () => {
    const source = scaffold({
      from: contractOf('userProfile', withIndex, FROM_HASH),
      to: contractOf('UserProfile', withIndex, TO_HASH),
    }).renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain('this.renameTable({ table: "userProfile", to: "UserProfile" })');
    expect(source).toContain(`userProfile_handle_idx_${HANDLE_INDEX_HASH}`);
    expect(source).toContain(`UserProfile_handle_idx_${HANDLE_INDEX_HASH}`);
  });

  it('refuses with MIGRATION.TABLE_RENAME_NO_PREVIOUS_CONTRACT when there is no previous contract', () => {
    expect(() => scaffold({ from: null, to: contractOf('UserProfile', {}, TO_HASH) })).toThrow(
      expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_NO_PREVIOUS_CONTRACT' }),
    );
  });

  it.each([
    [
      'the old name',
      { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
    ],
    [
      'the new name',
      { from: { name: 'userProfile' }, to: { namespaceId: 'auth', name: 'UserProfile' } },
    ],
  ])(
    'refuses a namespace qualifier on %s with MIGRATION.TABLE_RENAME_UNMATCHED',
    (_side, intent) => {
      expect(() =>
        scaffold({
          from: contractOf('userProfile', {}, FROM_HASH),
          to: contractOf('UserProfile', {}, TO_HASH),
          intents: [intent],
        }),
      ).toThrow(expect.objectContaining({ code: 'MIGRATION.TABLE_RENAME_UNMATCHED' }));
    },
  );

  it('scaffolds an empty body without renames', () => {
    const empty = createSqliteMigrationPlanner(stubLowerer).emptyMigration(
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
