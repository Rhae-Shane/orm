import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import type { AttributeCtx } from '../src/exports';
import { literal } from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { FieldAttributeAst } from '../src/syntax/ast/attributes';
import type { ExpressionAst } from '../src/syntax/ast/expressions';
import { createSyntaxTree } from '../src/syntax/red';

function argOf(exprSource: string): { expr: ExpressionAst; ctx: AttributeCtx } {
  const cursor = new Cursor(`@default(${exprSource})`);
  const node = FieldAttributeAst.cast(createSyntaxTree(parseAttribute(cursor)));
  if (!node) throw new Error('expected a field attribute');
  const expr = [...(node.argList()?.args() ?? [])][0]?.value();
  if (!expr) throw new Error('expected an argument expression');
  return { expr, ctx: { sourceId: 'schema.prisma', sourceFile: cursor.sourceFile } };
}

describe('literal', () => {
  it('reads a string literal with its escapes resolved', () => {
    const { expr, ctx } = argOf('"a\\"b\\\\c\\n"');

    const result = literal().parse(expr, ctx);

    expect(result).toEqual(ok({ kind: 'string', text: 'a"b\\c\n' }));
  });

  it.each([
    ['trailing zeros', '1.50'],
    ['an integer beyond 2^53', '9007199254740993'],
    ['a negative decimal', '-1.25'],
    ['a keyword number', 'NaN'],
    ['a negative keyword number', '-Infinity'],
  ])('keeps %s as written', (_name, source) => {
    const { expr, ctx } = argOf(source);

    const result = literal().parse(expr, ctx);

    expect(result).toEqual(ok({ kind: 'number', text: source }));
  });

  it.each(['true', 'false'])('reads %s as a boolean literal', (source) => {
    const { expr, ctx } = argOf(source);

    const result = literal().parse(expr, ctx);

    expect(result).toEqual(ok({ kind: 'boolean', text: source }));
  });

  it.each([
    ['a function call', 'now()'],
    ['an identifier', 'Foo'],
    ['a list', '[1, 2]'],
  ])('rejects %s', (_name, source) => {
    const { expr, ctx } = argOf(source);

    const result = literal().parse(expr, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]?.message).toBe('Expected a string, number, or boolean literal');
    }
  });

  it('carries the literal kind and label', () => {
    expect(literal()).toMatchObject({ kind: 'literal', label: 'literal' });
  });
});
