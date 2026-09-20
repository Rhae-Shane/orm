import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '../../src/core/migrations/issue-planner';
import {
  CreateFunctionCall,
  CreateTableCall,
  DropFunctionCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createFunction,
  dropFunction,
  functionIdentitySignature,
} from '../../src/core/migrations/operations/functions';
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
  it('plans CREATE FUNCTION before CREATE TABLE when both are missing', () => {
    const contract = makeContract();
    const actual = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {},
          functions: [],
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: '',
    });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: actual,
      frameworkComponents: [],
    });
    const result = planIssues({
      issues: coalesceSubtreeIssues(issues),
      toContract: contract,
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      storageTypes: contract.storage.types ?? {},
      strategies: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const calls = result.value.calls;
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

  it('rejects not-equal function drift instead of planning CREATE OR REPLACE', () => {
    const contract = makeContract();
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
      roles: [],
      existingSchemas: ['public'],
      pgVersion: '',
    });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: actual,
      frameworkComponents: [],
    });
    const result = planIssues({
      issues: coalesceSubtreeIssues(issues),
      toContract: contract,
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      storageTypes: contract.storage.types ?? {},
      strategies: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure[0]?.summary).toMatch(/not supported yet|drop and recreate/i);
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

  it('renders DROP FUNCTION without DEFAULT clauses (identity keeps arg names + types)', () => {
    const op = dropFunction({
      schemaName: 'public',
      functionName: 'app_nanoid',
      signature: 'size int DEFAULT 16',
    });
    expect(op.execute[0]?.sql).toBe('DROP FUNCTION "public"."app_nanoid"(size int);');
  });

  it('DropFunctionCall normalizes the declaration signature for DROP SQL and TS render', async () => {
    const call = new DropFunctionCall('public', 'app_nanoid', 'size int DEFAULT 16');
    expect(call.signature).toBe('size int');
    expect(call.renderTypeScript()).toBe(
      'this.dropFunction({ schema: "public", functionName: "app_nanoid", signature: "size int" })',
    );
    const op = await call.toOp();
    expect(op.execute[0]?.sql).toBe('DROP FUNCTION "public"."app_nanoid"(size int);');
  });
});

describe('functionIdentitySignature', () => {
  it('strips DEFAULT clauses and keeps names with types', () => {
    expect(functionIdentitySignature('size int DEFAULT 16')).toBe('size int');
    expect(functionIdentitySignature("a int = 1, b text DEFAULT 'x'")).toBe('a int, b text');
  });

  it('does not treat DEFAULT as a substring of an identifier', () => {
    expect(functionIdentitySignature('mydefault int')).toBe('mydefault int');
    expect(functionIdentitySignature('size int DEFAULTED 16')).toBe('size int DEFAULTED 16');
    expect(functionIdentitySignature('éDEFAULT int')).toBe('éDEFAULT int');
  });

  it('strips modes and omits OUT arguments from identity', () => {
    expect(functionIdentitySignature('IN a int, OUT b text, INOUT c int')).toBe('a int, c int');
    expect(functionIdentitySignature('VARIADIC arr int[]')).toBe('arr int[]');
  });

  it('preserves unnamed and multi-word types intact', () => {
    expect(functionIdentitySignature('int')).toBe('int');
    expect(functionIdentitySignature('double precision')).toBe('double precision');
    expect(functionIdentitySignature('x double precision')).toBe('x double precision');
    expect(functionIdentitySignature('n numeric(10, 2)')).toBe('n numeric(10, 2)');
    expect(functionIdentitySignature('interval day to second')).toBe('interval day to second');
  });

  it('ignores commas inside dollar-quoted DEFAULT values', () => {
    expect(functionIdentitySignature('a text DEFAULT $$x,y$$, b int')).toBe('a text, b int');
    expect(functionIdentitySignature('a text DEFAULT $tag$a,b$tag$, b int')).toBe('a text, b int');
  });

  it('does not treat $ inside an identifier as a dollar-quote delimiter', () => {
    expect(functionIdentitySignature('foo$tag$ int DEFAULT 1')).toBe('foo$tag$ int');
    expect(functionIdentitySignature('é$tag$ int DEFAULT 1')).toBe('é$tag$ int');
  });

  it('treats doubled quotes inside double-quoted identifiers as escapes', () => {
    expect(functionIdentitySignature('"a"",""b" int DEFAULT 1, c text')).toBe(
      '"a"",""b" int, c text',
    );
    expect(functionIdentitySignature('"a,b" int, c text')).toBe('"a,b" int, c text');
  });

  it('returns empty for zero-arg and OUT-only declarations', () => {
    expect(functionIdentitySignature('')).toBe('');
    expect(functionIdentitySignature('OUT b text')).toBe('');
  });
});
