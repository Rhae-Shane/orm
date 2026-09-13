/**
 * A native enum that lives outside `public` verifies clean. Introspection
 * reports the column type through `format_type`, which spells a mixed-case
 * type outside the search path as `audit."AuditAction"`; the contract side
 * spells it `audit.AuditAction`. Both must compare equal, as they already do
 * for a `public` enum (`"AuditAction"` is unquoted on introspection).
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { PostgresNativeEnum, postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('namespaced-enum'),
    storage: new SqlStorage({
      storageHash: coreHash('namespaced-enum'),
      namespaces: {
        audit: postgresCreateNamespace({
          id: asNamespaceId('audit'),
          entries: {
            table: {
              audit_log: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  action: {
                    nativeType: 'audit.AuditAction',
                    codecId: 'pg/enum@1',
                    nullable: false,
                    typeParams: { typeName: 'audit.AuditAction' },
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: 'audit',
                      entityName: 'AuditAction',
                    },
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            native_enum: {
              AuditAction: new PostgresNativeEnum({
                typeName: 'AuditAction',
                members: ['CREATE', 'DELETE'],
              }),
            },
            valueSet: { AuditAction: { kind: 'valueSet', values: ['CREATE', 'DELETE'] } },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('a native enum outside public verifies clean', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('reports zero findings for a mixed-case enum type in another schema', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE SCHEMA IF NOT EXISTS audit');
    await driver!.query(`CREATE TYPE "audit"."AuditAction" AS ENUM ('CREATE', 'DELETE')`);
    await driver!.query(
      'CREATE TABLE "audit"."audit_log" (id int PRIMARY KEY, action "audit"."AuditAction" NOT NULL)',
    );

    const contract = buildContract();
    const introspected = await familyInstance.introspect({ driver: driver!, contract });
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema: introspected,
      strict: false,
      frameworkComponents,
    });

    expect(verifyResult.schema.issues.map((issue) => issue.path)).toEqual([]);
    expect(verifyResult.ok).toBe(true);
  });
});
