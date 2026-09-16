import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { FieldDeclarationAst, ModelDeclarationAst } from '../src/syntax/ast/declarations';
import { TaggedLiteralExprAst } from '../src/syntax/ast/expressions';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import { printSyntax } from '../src/syntax/ast-helpers';
import { highlight, printTree } from './support';

function firstDefaultArg(source: string) {
  const result = parse(source);
  let attribute: FieldAttributeAst | undefined;
  for (const model of result.document.declarations()) {
    const m = ModelDeclarationAst.cast(model.syntax);
    if (!m) continue;
    for (const field of m.fields()) {
      for (const attr of field.attributes()) {
        attribute = attr;
      }
    }
  }
  if (!attribute) throw new Error('expected a field attribute');
  const arg = [...(attribute.argList()?.args() ?? [])][0];
  if (!arg) throw new Error('expected an attribute argument');
  return { result, attribute, value: arg.value() };
}

function taggedDefault(argument: string) {
  const { result, value } = firstDefaultArg(`model T {\n  id String @default(${argument})\n}\n`);
  const literal = value ? TaggedLiteralExprAst.cast(value.syntax) : undefined;
  if (!literal) throw new Error(`expected a tagged literal, got ${value?.syntax.kind}`);
  return { result, literal };
}

describe('TaggedLiteral parsing', () => {
  it('reads a backtick fence on one line', () => {
    const { result, literal } = taggedDefault('sql`gen_random_uuid()`');
    expect(result.diagnostics).toEqual([]);
    expect(literal.tag()).toBe('sql');
    expect(literal.fence()).toBe('backtick');
    expect(literal.rawBody()).toBe('gen_random_uuid()');
    expect(literal.body()).toBe('gen_random_uuid()');
  });

  it('pins the tree shape', () => {
    const { literal } = taggedDefault('pg.sql`now()`');
    expect(printTree(literal.syntax.green)).toMatchInlineSnapshot(`
      "TaggedLiteral
        Identifier
          Ident "pg"
        Dot "."
        Identifier
          Ident "sql"
        TemplateLiteral "\`now()\`""
    `);
  });

  it('canonicalizes a multi-line body', () => {
    const { result, literal } = taggedDefault(
      "sql`\n    (now()\n      + '00:03:00'::interval)\n  `",
    );
    expect(result.diagnostics).toEqual([]);
    expect(literal.rawBody()).toBe("\n    (now()\n      + '00:03:00'::interval)\n  ");
    expect(literal.body()).toBe("(now()\n  + '00:03:00'::interval)");
  });

  it('resolves an escaped backtick', () => {
    const { literal } = taggedDefault('sql`a\\`b`');
    expect(literal.rawBody()).toBe('a\\`b');
    expect(literal.body()).toBe('a`b');
  });

  it('resolves a double backslash to one backslash', () => {
    const { literal } = taggedDefault('sql`a\\\\b`');
    expect(literal.body()).toBe('a\\b');
  });

  it('resolves an escaped dollar sign', () => {
    const { literal } = taggedDefault('sql`\\$1`');
    expect(literal.body()).toBe('$1');
  });

  it('keeps every other backslash sequence as written', () => {
    const { literal } = taggedDefault("sql`E'\\n'`");
    expect(literal.body()).toBe("E'\\n'");
  });

  it('reports an unterminated template literal at the opening backtick', () => {
    const source = 'model T {\n  id String @default(sql`abc\n}\n';
    const result = parse(source);
    const diagnostic = result.diagnostics.find(
      (d) => d.code === 'PSL_UNTERMINATED_TEMPLATE_LITERAL',
    );
    expect(diagnostic?.message).toBe('Unterminated template literal');
    expect(highlight(result.sourceFile, diagnostic!.range)).toMatchInlineSnapshot(`
      "
      model T {
        id String @default(sql\`abc
                              ~
      }

      "
    `);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('joins a dotted tag', () => {
    const { result, literal } = taggedDefault('a.b.c`x`');
    expect(result.diagnostics).toEqual([]);
    expect(literal.tag()).toBe('a.b.c');
  });

  it('reports whitespace between the tag and the fence at the identifier', () => {
    const source = 'model T {\n  id String @default(sql `x`)\n}\n';
    const result = parse(source);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_TAGGED_LITERAL_FENCE_EXPECTED']);
    expect(result.diagnostics[0]?.message).toBe(
      'Expected the literal fence to follow the tag "sql" directly, with no space between',
    );
    expect(highlight(result.sourceFile, result.diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      model T {
        id String @default(sql \`x\`)
                           ~~~
      }

      "
    `);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('reports a newline between the tag and the fence', () => {
    const result = parse('model T {\n  id String @default(sql\n`x`)\n}\n');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_TAGGED_LITERAL_FENCE_EXPECTED']);
  });

  it('reads a quote fence with string escapes resolved', () => {
    const { result, literal } = taggedDefault('sql"a\\"b `c`"');
    expect(result.diagnostics).toEqual([]);
    expect(literal.fence()).toBe('quote');
    expect(literal.rawBody()).toBe('a\\"b `c`');
    expect(literal.body()).toBe('a"b `c`');
  });

  it('gives the same body for both fences', () => {
    expect(taggedDefault('sql`gen_random_uuid()`').literal.body()).toBe(
      taggedDefault('sql"gen_random_uuid()"').literal.body(),
    );
  });

  it('leaves body() undefined when the body contains ${', () => {
    const { result, literal } = taggedDefault('sql`$' + '{x}`');
    expect(result.diagnostics).toEqual([]);
    expect(literal.rawBody()).toBe('$' + '{x}');
    expect(literal.body()).toBeUndefined();
  });

  it('round-trips the source through printSyntax', () => {
    const source =
      'model T {\n  a String @default(sql`\n    x\n  `)\n  b String @default(pg.sql"y")\n}\n';
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('is accepted anywhere an expression is, including array elements and block values', () => {
    const source = 'generator g {\n  x = sql`a`\n}\nmodel T {\n  a String @x([sql`a`, t"b"])\n}\n';
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(printSyntax(result.document.syntax)).toBe(source);
  });

  it('still parses a bare identifier and a function call as before', () => {
    const { result, value } = firstDefaultArg('model T {\n  id String @default(now)\n}\n');
    expect(result.diagnostics).toEqual([]);
    expect(value && IdentifierAst.cast(value.syntax)?.name()).toBe('now');
    const call = firstDefaultArg('model T {\n  id String @default(pg.now())\n}\n');
    expect(call.value?.syntax.kind).toBe('FunctionCall');
  });

  it('exposes the field through the typed layer', () => {
    const result = parse('model T {\n  id String @default(sql`x`)\n}\n');
    const model = ModelDeclarationAst.cast([...result.document.declarations()][0]!.syntax);
    const field = [...model!.fields()][0];
    expect(field).toBeInstanceOf(FieldDeclarationAst);
  });
});
