import { describe, expect, it } from 'vitest';
import type { FieldAttributeCtx } from '../src/exports';
import { oneOf, str, taggedLiteral } from '../src/exports';
import { Cursor, parse, parseAttribute } from '../src/parse';
import type { SourceFile } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function makeCtx(sourceFile: SourceFile): FieldAttributeCtx {
  const { document, sourceFile: modelSource } = parse('model M {\n  id Int @id\n}\n');
  const { table } = buildSymbolTable({
    document,
    sourceFile: modelSource,
    pslBlockDescriptors: {},
  });
  const selfModel = table.topLevel.models['M'];
  if (!selfModel) throw new Error('expected model M in the symbol table');
  const field = selfModel.fields['id'];
  if (!field) throw new Error('expected field id on model M');
  return {
    sourceId: 'schema.prisma',
    sourceFile,
    selfModel,
    field,
    resolveReferencedModel: () => undefined,
  };
}

function argOf(exprSource: string): { expr: ExpressionAst; ctx: FieldAttributeCtx } {
  const cursor = new Cursor(`@x(${exprSource})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a field attribute');
  const first = [...(node.argList()?.args() ?? [])][0];
  const expr = first?.value();
  if (!expr) throw new Error('expected an argument expression');
  return { expr, ctx: makeCtx(cursor.sourceFile) };
}

describe('oneOf with a tagged literal alternative', () => {
  const type = oneOf(str(), taggedLiteral(['sql'], { documentation: 'Raw SQL.' }));

  it('surfaces the one alternative-specific failure instead of the generic list', () => {
    const { expr, ctx } = argOf('pg.sql`x`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
          message: 'Unknown literal tag "pg.sql". Known tags: sql.',
        }),
      ]);
    }
  });

  it('returns the first specific failure when several alternatives produce one', () => {
    const twoTagArms = oneOf(
      taggedLiteral(['sql'], { documentation: 'Raw SQL.' }),
      taggedLiteral(['pg.sql'], { documentation: 'Raw SQL.' }),
    );
    const { expr, ctx } = argOf('other`x`');
    const result = twoTagArms.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual([
        expect.objectContaining({ message: 'Unknown literal tag "other". Known tags: sql.' }),
      ]);
    }
  });

  it('keeps the generic list when no alternative fails with a specific code', () => {
    const { expr, ctx } = argOf('42');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure[0]).toMatchObject({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected one of: string | sql`...`',
      });
    }
  });
});

describe('taggedLiteral', () => {
  const type = taggedLiteral(['sql', 'pg.sql'], { documentation: 'Raw SQL, used verbatim.' });

  it('labels itself with the first tag', () => {
    expect(type.kind).toBe('taggedLiteral');
    expect(type.label).toBe('sql`...`');
    expect(type.tags).toEqual(['sql', 'pg.sql']);
    expect(type.documentation).toBe('Raw SQL, used verbatim.');
  });

  it('accepts a known tag and returns the canonical body with its span', () => {
    const { expr, ctx } = argOf('pg.sql`\n  now()\n`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        tag: 'pg.sql',
        body: 'now()',
        span: { start: { offset: 3, line: 1, column: 4 }, end: { offset: 20, line: 3, column: 2 } },
      });
    }
  });

  it('accepts a quote fence', () => {
    const { expr, ctx } = argOf('sql"now()"');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ tag: 'sql', body: 'now()' });
  });

  it('rejects an unknown tag and lists the known tags in registration order', () => {
    const { expr, ctx } = argOf('sqlite.sql`x`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual([
        {
          code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
          message: 'Unknown literal tag "sqlite.sql". Known tags: sql, pg.sql.',
          sourceId: 'schema.prisma',
          span: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 16, line: 1, column: 17 },
          },
        },
      ]);
    }
  });

  it('rejects an argument that is not a tagged literal', () => {
    for (const source of ['"sql"', 'sql', 'sql()', '42']) {
      const { expr, ctx } = argOf(source);
      const result = type.parse(expr, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure).toHaveLength(1);
        expect(result.failure[0]).toMatchObject({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Expected a tagged literal',
        });
      }
    }
  });

  it('reports interpolation at the literal', () => {
    const { expr, ctx } = argOf('sql`$' + '{x}`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual([
        {
          code: 'PSL_TAGGED_LITERAL_INTERPOLATION',
          message: 'Tagged literals do not support $' + '{...} interpolation.',
          sourceId: 'schema.prisma',
          span: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 12, line: 1, column: 13 },
          },
        },
      ]);
    }
  });

  it('reports interpolation for an escaped dollar and for a quote fence', () => {
    for (const source of ['sql`\\$' + '{x}`', 'sql"$' + '{x}"']) {
      const { expr, ctx } = argOf(source);
      const result = type.parse(expr, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure[0]?.code).toBe('PSL_TAGGED_LITERAL_INTERPOLATION');
      }
    }
  });

  it('reports a NUL character', () => {
    const { expr, ctx } = argOf('sql`a\0b`');
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure[0]).toMatchObject({
        code: 'PSL_TAGGED_LITERAL_NUL',
        message: 'Tagged literals must not contain NUL characters.',
      });
    }
  });

  it('reports a body over 65536 bytes', () => {
    const { expr, ctx } = argOf(`sql\`${'a'.repeat(65537)}\``);
    const result = type.parse(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure[0]).toMatchObject({
        code: 'PSL_TAGGED_LITERAL_TOO_LARGE',
        message: 'Tagged literal exceeds 65536 bytes.',
      });
    }
  });
});
