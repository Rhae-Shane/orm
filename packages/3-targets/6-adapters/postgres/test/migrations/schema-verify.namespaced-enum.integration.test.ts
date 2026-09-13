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

interface EnumTableCase {
  readonly schema: string;
  readonly table: string;
  readonly enumName: string;
  readonly typeName: string;
}

/** One table whose `action` column is typed by a native enum, in the given schema. */
function buildContract(input: EnumTableCase): Contract<SqlStorage> {
  const qualifiedType =
    input.schema === 'public' ? input.typeName : `${input.schema}.${input.typeName}`;
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('namespaced-enum'),
    storage: new SqlStorage({
      storageHash: coreHash('namespaced-enum'),
      namespaces: {
        [input.schema]: postgresCreateNamespace({
          id: asNamespaceId(input.schema),
          entries: {
            table: {
              [input.table]: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  action: {
                    nativeType: qualifiedType,
                    codecId: 'pg/enum@1',
                    nullable: false,
                    typeParams: { typeName: qualifiedType },
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: input.schema,
                      entityName: input.enumName,
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
              [input.enumName]: new PostgresNativeEnum({
                typeName: input.typeName,
                members: ['CREATE', 'DELETE'],
              }),
            },
            valueSet: { [input.enumName]: { kind: 'valueSet', values: ['CREATE', 'DELETE'] } },
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

async function verifyEnumTable(
  driver: PostgresControlDriver,
  input: EnumTableCase,
): Promise<readonly (readonly string[])[]> {
  const quotedType = `"${input.schema}"."${input.typeName}"`;
  if (input.schema !== 'public') {
    await driver.query(`CREATE SCHEMA IF NOT EXISTS "${input.schema}"`);
  }
  await driver.query(`CREATE TYPE ${quotedType} AS ENUM ('CREATE', 'DELETE')`);
  await driver.query(
    `CREATE TABLE "${input.schema}"."${input.table}" (id int PRIMARY KEY, action ${quotedType} NOT NULL)`,
  );
  const contract = buildContract(input);
  const introspected = await familyInstance.introspect({ driver, contract });
  const verifyResult = familyInstance.verifySchema({
    contract,
    schema: introspected,
    strict: false,
    frameworkComponents,
  });
  return verifyResult.schema.issues.map((issue) => issue.path);
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
    const paths = await verifyEnumTable(driver!, {
      schema: 'audit',
      table: 'audit_log',
      enumName: 'AuditAction',
      typeName: 'AuditAction',
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for a type name that contains a dot', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'public',
      table: 'dotted_log',
      enumName: 'Dotted',
      typeName: 'a.b',
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for a dotted type name in another schema', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'sch',
      table: 'dotted_log',
      enumName: 'Dotted',
      typeName: 'a.b',
    });
    expect(paths).toEqual([]);
  });
});
