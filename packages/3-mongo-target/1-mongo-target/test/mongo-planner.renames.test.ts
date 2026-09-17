import { coreHash } from '@internal/contract/types';
import type { StorageEntityRename } from '@internal/framework-components/control';
import {
  buildMongoNamespace,
  MongoCollection,
  type MongoContract,
  MongoStorage,
} from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/mongo-planner';

const RENAMES: readonly StorageEntityRename[] = [
  { from: { name: 'userProfile' }, to: { name: 'UserProfile' } },
];

function contractWith(collectionName: string): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: new MongoStorage({
      storageHash: coreHash('to-storage'),
      namespaces: {
        __unbound__: buildMongoNamespace({
          id: '__unbound__',
          entries: { collection: { [collectionName]: new MongoCollection({}) } },
        }),
      },
    }),
  } as unknown as MongoContract;
}

describe('MongoMigrationPlanner stated renames', () => {
  const planner = new MongoMigrationPlanner();

  it('refuses to plan when renames are given, instead of planning a collection drop', () => {
    const result = planner.plan({
      contract: contractWith('UserProfile'),
      schema: new MongoSchemaIR([new MongoSchemaCollection({ name: 'userProfile', indexes: [] })]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: contractWith('userProfile'),
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
      renames: RENAMES,
    });

    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'renameUnsupported',
          summary:
            'MIGRATION.RENAME_UNSUPPORTED: MongoDB does not support stated renames ("userProfile=UserProfile"), so nothing was planned.',
          why: 'The MongoDB planner has no rename operation, so it cannot keep the documents of a renamed collection. Rename the collection by hand with renameCollection, then plan again without the rename.',
        },
      ],
    });
  });

  it('refuses to scaffold when renames are given', () => {
    expect(() =>
      planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: '00',
        toHash: '01',
        snapshotsImportPath: '../../snapshots',
        renames: RENAMES,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.RENAME_UNSUPPORTED',
        message:
          'MongoDB does not support stated renames ("userProfile=UserProfile"), so nothing was scaffolded.',
        why: 'The MongoDB planner has no rename operation, so it cannot keep the documents of a renamed collection. Rename the collection by hand with renameCollection, then scaffold again without the rename.',
      }),
    );
  });

  it('plans and scaffolds as usual when the renames list is empty', () => {
    const result = planner.plan({
      contract: contractWith('users'),
      schema: new MongoSchemaIR([new MongoSchemaCollection({ name: 'users', indexes: [] })]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
      renames: [],
    });
    const scaffold = planner.emptyMigration({
      packageDir: '/tmp/migration-pkg',
      fromHash: '00',
      toHash: '01',
      snapshotsImportPath: '../../snapshots',
      renames: [],
    });

    expect(result.kind).toBe('success');
    expect(scaffold.operations).toEqual([]);
  });
});
