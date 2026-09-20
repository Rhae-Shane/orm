import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '../../src/core/migrations/issue-planner';
import {
  CreateFunctionCall,
  CreateTableCall,
  type PostgresOpFactoryCall,
} from '../../src/core/migrations/op-factory-call';
import { createFunction } from '../../src/core/migrations/operations/functions';
import { PostgresFunction } from '../../src/core/postgres-function';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresFunctionSchemaNode } from '../../src/core/schema-ir/postgres-function-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';

const APP_NANOID_BODY = `DECLARE
  id text := '';
BEGIN
  RETURN id;
END`;

function makeContract(): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        user: new StorageTable({
          columns: {
            id: {
              nativeType: 'varchar(16)',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'function', expression: 'app_nanoid(16)' },
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      function: {
        app_nanoid: new PostgresFunction({
          functionName: 'app_nanoid',
          signature: 'size int DEFAULT 16',
          returns: 'text',
          body: APP_NANOID_BODY,
        }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('function-create'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('function-create'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: { namespaces: { public: { models: {} } } },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('Postgres function migration planning', () => {
  it('plans CREATE FUNCTION before CREATE TABLE when both are missing', async () => {
    const expected = buildPostgresPlanDiff({ contract: makeContract() }).expected;
    const actual = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {},
          functions: [],
        }),
      },
      roles: {},
      existingSchemas: ['public'],
      pgVersion: '',
    });
    const issues = coalesceSubtreeIssues(
      buildPostgresPlanDiff({ contract: makeContract(), actual }).issues,
    );
    const result = await planIssues(issues, {
      expected,
      actual,
      codecHooks: new Map(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const calls = result.value as readonly PostgresOpFactoryCall[];
    const createFunctionIdx = calls.findIndex((call) => call instanceof CreateFunctionCall);
    const createTableIdx = calls.findIndex((call) => call instanceof CreateTableCall);
    expect(createFunctionIdx).toBeGreaterThanOrEqual(0);
    expect(createTableIdx).toBeGreaterThanOrEqual(0);
    expect(createFunctionIdx).toBeLessThan(createTableIdx);
  });

  it('renders CREATE FUNCTION with the opaque body (not OR REPLACE)', () => {
    const op = createFunction({
      schemaName: 'public',
      functionName: 'app_nanoid',
      signature: 'size int DEFAULT 16',
      returns: 'text',
      body: APP_NANOID_BODY,
      language: 'plpgsql',
      volatility: 'STABLE',
    });
    const sql = op.execute[0]?.sql ?? '';
    expect(sql).toContain('CREATE FUNCTION "public"."app_nanoid"(size int DEFAULT 16)');
    expect(sql).not.toContain('OR REPLACE');
    expect(sql).toContain('RETURNS text');
    expect(sql).toContain('LANGUAGE plpgsql STABLE');
    expect(sql).toContain(APP_NANOID_BODY);
  });

  it('rejects not-equal function drift instead of planning CREATE OR REPLACE', async () => {
    const expected = buildPostgresPlanDiff({ contract: makeContract() }).expected;
    const actualFn = new PostgresFunctionSchemaNode({
      functionName: 'app_nanoid',
      namespaceId: 'public',
      signature: 'size int DEFAULT 16',
      returns: 'text',
      body: 'RETURN null;',
      language: 'plpgsql',
      volatility: 'STABLE',
    });
    const actual = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {},
          functions: [actualFn],
        }),
      },
      roles: {},
      existingSchemas: ['public'],
      pgVersion: '',
    });
    const issues = coalesceSubtreeIssues(
      buildPostgresPlanDiff({ contract: makeContract(), actual }).issues,
    );
    const result = await planIssues(issues, {
      expected,
      actual,
      codecHooks: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.summary).toMatch(/not supported yet|drop and recreate/i);
  });

  it('diff equality ignores control and matches authored fields', () => {
    const a = new PostgresFunctionSchemaNode({
      functionName: 'app_nanoid',
      namespaceId: 'public',
      signature: 'size int DEFAULT 16',
      returns: 'text',
      body: APP_NANOID_BODY,
      language: 'plpgsql',
      volatility: 'STABLE',
    });
    const b = new PostgresFunctionSchemaNode({
      functionName: 'app_nanoid',
      namespaceId: 'public',
      signature: 'size int DEFAULT 16',
      returns: 'text',
      body: APP_NANOID_BODY,
      language: 'plpgsql',
      volatility: 'STABLE',
      control: 'managed',
    });
    expect(a.isEqualTo(b)).toBe(true);
  });
});
