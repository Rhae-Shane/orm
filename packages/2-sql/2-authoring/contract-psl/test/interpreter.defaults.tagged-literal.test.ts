import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';

describe('interpretPslDocumentToSqlContract tagged literal defaults', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpret = (fieldLine: string) => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Lit {\n  id Int @id\n  ${fieldLine}\n}\n`,
      sourceId: 'schema.prisma',
    });
    return interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });
  };
  const columnDefault = (fieldLine: string, column: string) => {
    const result = interpret(fieldLine);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    return sqlStorageFromSuccessfulSqlInterpretation(result.value).namespaces['public']?.entries
      .table?.['Lit']?.columns[column]?.default;
  };
  const diagnostics = (fieldLine: string) => {
    const result = interpret(fieldLine);
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.failure.diagnostics;
  };

  it.each([
    ['backtick fence', 'v String @default(sql`gen_random_uuid()`)'],
    ['quote fence', 'v String @default(sql"gen_random_uuid()")'],
    ['pg.sql tag', 'v String @default(pg.sql`gen_random_uuid()`)'],
  ])('lowers the %s to a function default with the canonical body', (_name, fieldLine) => {
    expect(columnDefault(fieldLine, 'v')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('lowers a multi-line body dedented', () => {
    expect(
      columnDefault(
        "v DateTime @default(sql`\n      (now()\n        + '00:03:00'::interval)\n    `)",
        'v',
      ),
    ).toEqual({ kind: 'function', expression: "(now()\n  + '00:03:00'::interval)" });
  });

  it('lowers an empty body with no diagnostic', () => {
    expect(columnDefault('v String @default(sql``)', 'v')).toEqual({
      kind: 'function',
      expression: '',
    });
  });

  it('lowers a tagged literal on a list column', () => {
    expect(columnDefault("tags String[] @default(sql`'{}'::text[]`)", 'tags')).toEqual({
      kind: 'function',
      expression: "'{}'::text[]",
    });
  });

  it('lowers gen_random_uuid() as a named storage function', () => {
    expect(columnDefault('v String @default(gen_random_uuid())', 'v')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('rejects an unregistered tag and lists the known tags', () => {
    expect(diagnostics('v String @default(sqlite.sql`x`)')).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
        message: 'Unknown literal tag "sqlite.sql". Known tags: sql, pg.sql.',
        sourceId: 'schema.prisma',
        span: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
      }),
    ]);
  });

  it('rejects a body the SQL check refuses', () => {
    expect(diagnostics('v String @default(sql`x; drop table t`)')).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_SQL',
        message:
          'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
        sourceId: 'schema.prisma',
      }),
    ]);
  });

  it('still rejects a client-side generator on a list column', () => {
    expect(diagnostics('tags String[] @default(uuid())')).toEqual([
      expect.objectContaining({ code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED' }),
    ]);
  });
});
