import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  createContractTable,
  createTestContract,
} from '../../../../2-sql/9-family/test/schema-verify.helpers';
import { parseSqliteDefault } from '../src/core/default-normalizer';
import { diffSqliteSchema } from '../src/core/migrations/diff-database-schema';
import { SqliteSchemaVerifier } from '../src/core/sqlite-schema-verifier';

describe('SqliteSchemaVerifier', () => {
  it('extends SqlSchemaVerifierBase', () => {
    const verifier = new SqliteSchemaVerifier();
    expect(verifier).toBeInstanceOf(SqlSchemaVerifierBase);
  });
});

describe('diffSqliteSchema resolves authored function defaults like introspected ones', () => {
  function actualSchema(rawDefault: string): SqlSchemaIR {
    return new SqlSchemaIR({
      tables: {
        event: new SqlTableIR({
          name: 'event',
          columns: {
            at: {
              name: 'at',
              nativeType: 'text',
              nullable: false,
              default: rawDefault,
              resolvedNativeType: 'text',
              ...(parseSqliteDefault(rawDefault, 'text') === undefined
                ? {}
                : { resolvedDefault: parseSqliteDefault(rawDefault, 'text') }),
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
    });
  }

  function contractWithDefault(expression: string) {
    return {
      ...createTestContract({
        event: createContractTable({
          at: {
            nativeType: 'text',
            codecId: 'sqlite/text@1',
            nullable: false,
            default: { kind: 'function', expression },
          },
        }),
      }),
      target: 'sqlite',
    };
  }

  it('reports nothing for sql`CURRENT_TIMESTAMP` against DEFAULT CURRENT_TIMESTAMP', () => {
    const result = diffSqliteSchema({
      contract: contractWithDefault('CURRENT_TIMESTAMP'),
      schema: actualSchema('CURRENT_TIMESTAMP'),
      frameworkComponents: [],
    });
    expect(result.issues).toEqual([]);
  });

  it('still reports a default that differs', () => {
    const result = diffSqliteSchema({
      contract: contractWithDefault('CURRENT_TIMESTAMP'),
      schema: actualSchema("'2020-01-01'"),
      frameworkComponents: [],
    });
    expect(result.issues).not.toEqual([]);
  });
});
