/**
 * `migration new --rename-table` on Postgres: the scaffold carries one rename call per intent, in the schema either side names.
 */

import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { StorageEntityRename } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

function scaffoldSource(renames: readonly StorageEntityRename[]): string {
  return createPostgresMigrationPlanner(stubLowerer)
    .emptyMigration(
      {
        packageDir: '/tmp/migration-pkg',
        fromHash: 'a'.repeat(64),
        toHash: 'b'.repeat(64),
        snapshotsImportPath: '../../snapshots',
        renames,
      },
      APP_SPACE_ID,
    )
    .renderTypeScript(keepInternalSpecifiers);
}

describe('Postgres scaffold rename-table intents', () => {
  it('leaves an unqualified intent unbound', () => {
    expect(
      scaffoldSource([{ from: { name: 'userProfile' }, to: { name: 'UserProfile' } }]),
    ).toContain('this.renameTable({ table: "userProfile", to: "UserProfile" })');
  });

  it('renames in the schema the old name is qualified with', () => {
    expect(
      scaffoldSource([
        { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      ]),
    ).toContain('this.renameTable({ schema: "auth", table: "userProfile", to: "UserProfile" })');
  });

  it('renames in the schema the new name is qualified with when the old name is not', () => {
    expect(
      scaffoldSource([
        { from: { name: 'userProfile' }, to: { namespaceId: 'auth', name: 'UserProfile' } },
      ]),
    ).toContain('this.renameTable({ schema: "auth", table: "userProfile", to: "UserProfile" })');
  });
});
