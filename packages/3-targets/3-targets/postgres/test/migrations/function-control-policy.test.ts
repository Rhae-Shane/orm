/**
 * Function entity control-policy + ownership: DROP only for managed unclaimed
 * extras; external / tolerated / observed must not drop live functions Prisma
 * does not own. Mirrors the native-enum planner ownership tests.
 */
import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  SchemaDiffIssue,
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { coordinateKey, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { resolvePostgresNodeIssueControlPolicySubject } from '../../src/core/migrations/control-policy';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresFunction } from '../../src/core/postgres-function';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresFunctionSchemaNode } from '../../src/core/schema-ir/postgres-function-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';

const BODY = 'RETURN null;';

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

const DB_UPDATE_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function emptyTable(): StorageTable {
  return new StorageTable({
    columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  });
}

function makeContract(options: {
  readonly defaultControlPolicy?: ControlPolicy;
  readonly withFunction?: boolean;
  readonly functionControl?: ControlPolicy;
}): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: { users: emptyTable() },
      ...(options.withFunction === false
        ? {}
        : {
            function: {
              app_nanoid: new PostgresFunction({
                functionName: 'app_nanoid',
                signature: 'size int DEFAULT 16',
                returns: 'text',
                body: BODY,
                ...(options.functionControl !== undefined
                  ? { control: options.functionControl }
                  : {}),
              }),
            },
          }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('function-control'),
    defaultControlPolicy: options.defaultControlPolicy ?? 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('function-control'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function tableNode(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'users',
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function functionNode(name: string): PostgresFunctionSchemaNode {
  return new PostgresFunctionSchemaNode({
    functionName: name,
    namespaceId: 'public',
    signature: 'size int DEFAULT 16',
    returns: 'text',
    body: BODY,
    language: 'plpgsql',
    volatility: 'STABLE',
  });
}

function liveTree(functions: readonly string[]) {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: { users: tableNode() },
        functions: functions.map(functionNode),
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

function ownsOnly(...coordinates: readonly SchemaEntityCoordinate[]): SchemaOwnership {
  const owned = new Set(coordinates.map(coordinateKey));
  return { declaresEntity: (coordinate) => owned.has(coordinateKey(coordinate)) };
}

async function planOps(
  contract: Contract<SqlStorage>,
  schema: PostgresDatabaseSchemaNode,
  ownership?: SchemaOwnership,
) {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  const result = planner.plan({
    contract,
    schema,
    policy: DB_UPDATE_POLICY,
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(ownership !== undefined ? { ownership } : {}),
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  return Promise.all(result.plan.operations);
}

describe('resolvePostgresNodeIssueControlPolicySubject — function entities', () => {
  const contract = makeContract({ withFunction: true });

  it('a function create issue resolves entityKind function and physical name', () => {
    const issue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'public', 'function:app_nanoid'],
      expected: functionNode('app_nanoid'),
    };
    expect(resolvePostgresNodeIssueControlPolicySubject(issue, contract)).toEqual({
      namespaceId: 'public',
      entityKind: 'function',
      entityName: 'app_nanoid',
      createsNewObject: true,
    });
  });

  it('a dropped (not-expected) function resolves to UNBOUND like a dropped enum', () => {
    const issue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'public', 'function:stray_helper'],
      actual: functionNode('stray_helper'),
    };
    expect(resolvePostgresNodeIssueControlPolicySubject(issue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'function',
      entityName: 'stray_helper',
      createsNewObject: false,
    });
  });
});

describe('DROP FUNCTION gated by control policy', () => {
  it('managed: drops an unclaimed live function under a destructive policy', async () => {
    const ops = await planOps(makeContract({ withFunction: false }), liveTree(['stray_helper']));
    expect(ops.some((op) => op.id.startsWith('dropFunction.'))).toBe(true);
  });

  it('external: never drops an undeclared live function', async () => {
    const ops = await planOps(
      makeContract({ withFunction: false, defaultControlPolicy: 'external' }),
      liveTree(['stray_helper']),
    );
    expect(ops.some((op) => op.id.startsWith('dropFunction.'))).toBe(false);
  });

  it('observed: never drops an undeclared live function', async () => {
    const ops = await planOps(
      makeContract({ withFunction: false, defaultControlPolicy: 'observed' }),
      liveTree(['stray_helper']),
    );
    expect(ops.some((op) => op.id.startsWith('dropFunction.'))).toBe(false);
  });

  it('tolerated: never drops an undeclared live function (drop is not create-if-absent)', async () => {
    const ops = await planOps(
      makeContract({ withFunction: false, defaultControlPolicy: 'tolerated' }),
      liveTree(['stray_helper']),
    );
    expect(ops.some((op) => op.id.startsWith('dropFunction.'))).toBe(false);
  });

  it('never drops a live function a sibling space declares', async () => {
    const siblingOwns = ownsOnly({
      namespaceId: 'public',
      entityKind: 'function',
      entityName: 'pack_helper',
    });
    const ops = await planOps(
      makeContract({ withFunction: false }),
      liveTree(['pack_helper', 'unowned_helper']),
      siblingOwns,
    );
    const dropIds = ops.filter((op) => op.id.startsWith('dropFunction.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropFunction.unowned_helper']);
  });
});
