/**
 * `--rename-table` on a SQLite table that carries indexes, constraints and foreign keys.
 *
 * SQLite renames a table's automatic indexes and rewrites foreign keys that reference it, and it names no primary key, unique or foreign key the contract leaves unnamed, so those need nothing beyond the rename. A wire-named index whose prefix derives from the table name keeps its old name through `ALTER TABLE ... RENAME TO`, and SQLite cannot rename an index, so it is dropped and created under the new name; an index holds no rows, so nothing is lost.
 */

import { APP_SPACE_ID } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import {
  contractOf,
  HANDLE_INDEX_HASH,
  handleIndex,
  type ProfileSpec,
  reference,
  stubLowerer,
} from './rename-table-fixtures';

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
    expect(await plannedLabels({ indexes: (t) => [handleIndex(t)] })).toEqual([
      RENAME_TABLE,
      `Drop index userProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
      `Create index UserProfile_handle_idx_${HANDLE_INDEX_HASH} on UserProfile`,
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
