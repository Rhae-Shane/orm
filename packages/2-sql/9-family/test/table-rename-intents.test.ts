import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { StorageEntityRename } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  isMaterializedSqlNamespace,
  SqlStorage,
  StorageTable,
  type StorageTableInput,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import {
  applyTableRenameIntents,
  TABLE_RENAME_NO_PREVIOUS_CONTRACT_CODE,
  TABLE_RENAME_UNMATCHED_CODE,
} from '../src/core/migrations/table-rename-intents';

const idColumn = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };

function table(extra: Partial<StorageTableInput> = {}): StorageTable {
  return new StorageTable({
    columns: { id: idColumn },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...extra,
  });
}

function contractOf(
  namespaces: Readonly<Record<string, Readonly<Record<string, StorageTable>>>>,
  hashSeed = 'seed',
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      types: { Money: toStorageTypeInstance({ codecId: 'pg/numeric@1', nativeType: 'numeric' }) },
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, tables]) => [
          id,
          createTestSqlNamespace({ id, entries: { table: tables } }),
        ]),
      ),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const rename = (from: string, to: string): StorageEntityRename => ({
  from: { name: from },
  to: { name: to },
});

function tablesOf(contract: Contract<SqlStorage>, namespaceId: string): readonly string[] {
  return Object.keys(contract.storage.namespaces[namespaceId]?.entries.table ?? {});
}

describe('applyTableRenameIntents', () => {
  it('re-keys the table under its new name and retargets every foreign key that named it', () => {
    const fromContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: {
        userProfile: table({
          columns: { id: idColumn, parentId: { ...idColumn, nullable: true } },
          foreignKeys: [
            {
              source: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['parentId'],
              },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['id'],
              },
              name: 'userProfile_parent_fkey',
            },
          ],
        }),
        post: table({
          columns: { id: idColumn, authorId: idColumn },
          foreignKeys: [
            {
              source: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'post',
                columns: ['authorId'],
              },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'userProfile',
                columns: ['id'],
              },
            },
          ],
        }),
      },
    });
    const toContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table(), post: table() },
    });

    const result = applyTableRenameIntents({
      renameTableReferences: undefined,
      fromContract,
      toContract,
      intents: [rename('userProfile', 'UserProfile')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.renames).toEqual([
      { namespaceId: UNBOUND_NAMESPACE_ID, from: 'userProfile', to: 'UserProfile' },
    ]);
    const renamed = result.value.contract;
    expect(tablesOf(renamed, UNBOUND_NAMESPACE_ID)).toEqual(['UserProfile', 'post']);
    const renamedTable =
      renamed.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['UserProfile'];
    expect(renamedTable).toBeInstanceOf(StorageTable);
    expect(Object.keys(renamedTable?.columns ?? {})).toEqual(['id', 'parentId']);
    expect(
      renamedTable?.foreignKeys.map((fk) => [fk.source.tableName, fk.target.tableName, fk.name]),
    ).toEqual([['UserProfile', 'UserProfile', 'userProfile_parent_fkey']]);
    const post = renamed.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['post'];
    expect(post?.foreignKeys.map((fk) => [fk.source.tableName, fk.target.tableName])).toEqual([
      ['post', 'UserProfile'],
    ]);
  });

  it('keeps the namespace class, the storage hash and types, and leaves the input untouched', () => {
    const fromContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { userProfile: table() },
      audit: { log: table() },
    });
    const toContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table() },
      audit: { log: table() },
    });

    const result = applyTableRenameIntents({
      renameTableReferences: undefined,
      fromContract,
      toContract,
      intents: [rename('userProfile', 'UserProfile')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.contract;
    const namespace = renamed.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(isMaterializedSqlNamespace(namespace)).toBe(true);
    expect(Object.getPrototypeOf(namespace)).toBe(
      Object.getPrototypeOf(fromContract.storage.namespaces[UNBOUND_NAMESPACE_ID]),
    );
    expect(namespace?.id).toBe(UNBOUND_NAMESPACE_ID);
    expect(renamed.storage.namespaces['audit']).toBe(fromContract.storage.namespaces['audit']);
    expect(renamed.storage.storageHash).toBe(fromContract.storage.storageHash);
    expect(renamed.storage.types).toEqual(fromContract.storage.types);
    expect(renamed.profileHash).toBe(fromContract.profileHash);
    expect(tablesOf(fromContract, UNBOUND_NAMESPACE_ID)).toEqual(['userProfile']);
  });

  it('resolves an unqualified name in whichever namespace declares it', () => {
    const fromContract = contractOf({ auth: { userProfile: table() }, app: { post: table() } });
    const toContract = contractOf({ auth: { UserProfile: table() }, app: { post: table() } });

    const result = applyTableRenameIntents({
      renameTableReferences: undefined,
      fromContract,
      toContract,
      intents: [rename('userProfile', 'UserProfile')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.renames).toEqual([
      { namespaceId: 'auth', from: 'userProfile', to: 'UserProfile' },
    ]);
    expect(tablesOf(result.value.contract, 'auth')).toEqual(['UserProfile']);
  });

  it('honours a namespace qualifier on either side', () => {
    const fromContract = contractOf({
      auth: { userProfile: table() },
      app: { userProfile: table() },
    });
    const toContract = contractOf({
      auth: { UserProfile: table() },
      app: { userProfile: table() },
    });

    const result = applyTableRenameIntents({
      renameTableReferences: undefined,
      fromContract,
      toContract,
      intents: [
        {
          from: { namespaceId: 'auth', name: 'userProfile' },
          to: { namespaceId: 'auth', name: 'UserProfile' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.renames).toEqual([
      { namespaceId: 'auth', from: 'userProfile', to: 'UserProfile' },
    ]);
    expect(tablesOf(result.value.contract, 'app')).toEqual(['userProfile']);
  });

  it('lets the target rename its own references to each renamed table in that table namespace', () => {
    const fromContract = contractOf({
      auth: { userProfile: table(), account: table() },
      app: { userProfile: table() },
    });
    const toContract = contractOf({
      auth: { UserProfile: table(), account: table() },
      app: { userProfile: table() },
    });
    const calls: string[] = [];

    const result = applyTableRenameIntents({
      fromContract,
      toContract,
      intents: [
        { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      ],
      renameTableReferences: (entries, applied) => {
        calls.push(`${applied.namespaceId}:${applied.from}>${applied.to}`);
        return { ...entries, marker: { [applied.to]: { tableName: applied.to } } };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual(['auth:userProfile>UserProfile']);
    expect(result.value.contract.storage.namespaces['auth']?.entries['marker']).toEqual({
      UserProfile: { tableName: 'UserProfile' },
    });
    expect(result.value.contract.storage.namespaces['app']?.entries['marker']).toBeUndefined();
  });

  it('returns nothing to do when there are no intents', () => {
    const fromContract = contractOf({ [UNBOUND_NAMESPACE_ID]: { userProfile: table() } });

    const result = applyTableRenameIntents({
      fromContract,
      toContract: fromContract,
      intents: [],
      renameTableReferences: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contract).toBe(fromContract);
    expect(result.value.renames).toEqual([]);
  });

  describe('unmatched intents', () => {
    const fromContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { userProfile: table(), Account: table() },
    });
    const toContract = contractOf({
      [UNBOUND_NAMESPACE_ID]: { UserProfile: table(), Account: table() },
    });

    function conflictsFor(intents: readonly StorageEntityRename[]) {
      const result = applyTableRenameIntents({
        fromContract,
        toContract,
        intents,
        renameTableReferences: undefined,
      });
      expect(result.ok).toBe(false);
      return result.ok ? [] : result.failure;
    }

    it('reports a previous table that does not exist', () => {
      expect(conflictsFor([rename('ghost', 'UserProfile')])).toEqual([
        expect.objectContaining({
          kind: 'tableRenameUnmatched',
          summary: expect.stringContaining('table "ghost" does not exist in the previous contract'),
          meta: { code: TABLE_RENAME_UNMATCHED_CODE, from: 'ghost', to: 'UserProfile' },
        }),
      ]);
    });

    it('reports a new name that already exists in the previous state', () => {
      expect(conflictsFor([rename('userProfile', 'Account')])).toEqual([
        expect.objectContaining({
          kind: 'tableRenameUnmatched',
          summary: expect.stringContaining(
            'table "Account" already exists in the previous contract',
          ),
        }),
      ]);
    });

    it('reports a new name that is absent from the next contract', () => {
      expect(conflictsFor([rename('userProfile', 'Profile')])).toEqual([
        expect.objectContaining({
          kind: 'tableRenameUnmatched',
          summary: expect.stringContaining('table "Profile" does not exist in the next contract'),
        }),
      ]);
    });

    it('reports a name whose namespace qualifier the contract does not have', () => {
      expect(
        conflictsFor([
          { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
        ]),
      ).toEqual([
        expect.objectContaining({
          kind: 'tableRenameUnmatched',
          summary: expect.stringContaining('"auth.userProfile"'),
        }),
      ]);
    });

    it('reports every unmatched intent, one conflict each, and applies none', () => {
      const conflicts = conflictsFor([
        rename('userProfile', 'UserProfile'),
        rename('ghost', 'UserProfile'),
        rename('userProfile', 'Profile'),
      ]);
      expect(conflicts.map((conflict) => conflict.meta)).toEqual([
        { code: TABLE_RENAME_UNMATCHED_CODE, from: 'ghost', to: 'UserProfile' },
        { code: TABLE_RENAME_UNMATCHED_CODE, from: 'userProfile', to: 'Profile' },
      ]);
    });

    it('reports an unqualified name declared in more than one namespace', () => {
      const ambiguousFrom = contractOf({
        auth: { userProfile: table() },
        app: { userProfile: table() },
      });
      const ambiguousTo = contractOf({
        auth: { UserProfile: table() },
        app: { userProfile: table() },
      });
      const result = applyTableRenameIntents({
        renameTableReferences: undefined,
        fromContract: ambiguousFrom,
        toContract: ambiguousTo,
        intents: [rename('userProfile', 'UserProfile')],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure[0]?.summary).toContain('more than one namespace');
    });

    it('rejects intents without a prior contract to apply them to, with its own code', () => {
      const result = applyTableRenameIntents({
        renameTableReferences: undefined,
        fromContract: null,
        toContract,
        intents: [rename('userProfile', 'UserProfile')],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure).toEqual([
        {
          kind: 'unsupportedOperation',
          summary: `${TABLE_RENAME_NO_PREVIOUS_CONTRACT_CODE}: --rename "userProfile=UserProfile" needs a previous contract to apply the rename to, and this plan starts from an empty database.`,
          why: 'A rename intent only makes sense between two contracts. Plan from the migration that created the table. A database managed with db update has no migration history: rename the table there by hand with ALTER TABLE ... RENAME TO ..., and drop the flag.',
          meta: { code: TABLE_RENAME_NO_PREVIOUS_CONTRACT_CODE },
        },
      ]);
    });

    describe('two intents that resolve to the same table', () => {
      const authFrom = contractOf({ auth: { userProfile: table(), account: table() } });
      const authTo = contractOf({ auth: { Profile: table(), Member: table(), account: table() } });

      function conflictsBetween(intents: readonly StorageEntityRename[]) {
        const result = applyTableRenameIntents({
          renameTableReferences: undefined,
          fromContract: authFrom,
          toContract: authTo,
          intents,
        });
        expect(result.ok).toBe(false);
        return result.ok ? [] : result.failure;
      }

      it('reports the second intent that renames the same old table', () => {
        expect(
          conflictsBetween([
            rename('userProfile', 'Profile'),
            { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'Member' } },
          ]),
        ).toEqual([
          expect.objectContaining({
            kind: 'tableRenameUnmatched',
            summary: `${TABLE_RENAME_UNMATCHED_CODE}: --rename "auth.userProfile=Member" does not match the contracts: table "auth.userProfile" is already renamed by --rename "userProfile=Profile".`,
            meta: { code: TABLE_RENAME_UNMATCHED_CODE, from: 'userProfile', to: 'Member' },
          }),
        ]);
      });

      it('reports the second intent that renames to the same new table', () => {
        expect(
          conflictsBetween([
            rename('userProfile', 'Profile'),
            { from: { name: 'account' }, to: { namespaceId: 'auth', name: 'Profile' } },
          ]),
        ).toEqual([
          expect.objectContaining({
            kind: 'tableRenameUnmatched',
            summary: `${TABLE_RENAME_UNMATCHED_CODE}: --rename "account=auth.Profile" does not match the contracts: table "auth.Profile" is already the new name in --rename "userProfile=Profile".`,
          }),
        ]);
      });
    });
  });
});
