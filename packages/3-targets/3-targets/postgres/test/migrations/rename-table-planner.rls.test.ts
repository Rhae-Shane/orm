/**
 * `--rename` on a row-level-security table: the Postgres `rls` marker and every policy name the table they attach to, so a rename moves them with the table. `ALTER TABLE ... RENAME TO` keeps RLS enabled and the policies attached, and policy names do not derive from the table name, so the plan is the rename alone.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { StorageEntityRename } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const RENAME: StorageEntityRename = {
  from: { name: 'userProfile' },
  to: { name: 'UserProfile' },
};

function rlsContract(tableName: string, hashSeed: string): Contract<SqlStorage> {
  const policy = new PostgresRlsPolicy({
    naming: { kind: 'wire', prefix: 'tenant_read', hash: 'f8d5e783' },
    tableName,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using: '(tenant_id = 1)',
    withCheck: undefined,
    permissive: true,
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: {
              [tableName]: new StorageTable({
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  tenant_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'], name: `${tableName}_pkey` },
                foreignKeys: [],
                uniques: [],
                indexes: [],
              }),
            },
            policy: { [policy.name]: policy },
            rls: { [tableName]: new PostgresRlsEnablement({ tableName, namespaceId: 'public' }) },
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

function plan(from: Contract<SqlStorage>, to: Contract<SqlStorage>) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, []),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    renames: [RENAME],
  });
}

describe('Postgres planner rename-table intents on an RLS table', () => {
  it('plans the rename alone for a table with RLS enabled and a policy', async () => {
    const result = plan(rlsContract('userProfile', 'from'), rlsContract('UserProfile', 'to'));

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual(['renameTable.userProfile']);
  });
});
