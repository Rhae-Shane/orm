/**
 * `migration new --rename-table` on SQLite: the scaffold carries one rename call per intent and refuses a namespace qualifier, as the planner does.
 */

import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { StorageEntityRename } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

function scaffold(renames: readonly StorageEntityRename[]) {
  return createSqliteMigrationPlanner(stubLowerer).emptyMigration(
    {
      packageDir: '/tmp/migration-pkg',
      fromHash: 'a'.repeat(64),
      toHash: 'b'.repeat(64),
      snapshotsImportPath: '../../snapshots',
      renames,
    },
    APP_SPACE_ID,
  );
}

describe('SQLite scaffold rename-table intents', () => {
  it('carries one rename call per unqualified intent', () => {
    const source = scaffold([
      { from: { name: 'userProfile' }, to: { name: 'UserProfile' } },
    ]).renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain('this.renameTable({ table: "userProfile", to: "UserProfile" })');
  });

  it.each([
    [
      'the old name',
      { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      '"auth.userProfile=UserProfile" names a namespace, "auth"',
    ],
    [
      'the new name',
      { from: { name: 'userProfile' }, to: { namespaceId: 'auth', name: 'UserProfile' } },
      '"userProfile=auth.UserProfile" names a namespace, "auth"',
    ],
  ])('refuses a namespace qualifier on %s, which SQLite does not have', (_side, intent, detail) => {
    expect(() => scaffold([intent])).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.TABLE_RENAME_UNMATCHED',
        message: `--rename-table ${detail}, and SQLite has no namespaces.`,
      }),
    );
  });
});
