/**
 * Prisma 7 constructs the parser must read so a Prisma 7 interpreter can walk
 * them with spans: attributes on enum members, and field lines inside `view`
 * blocks. Prisma 8 documents must parse exactly as before.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { GenericBlockDeclarationAst } from '../src/syntax/ast/declarations';
import { StringLiteralExprAst } from '../src/syntax/ast/expressions';
import type { GreenElement } from '../src/syntax/green';
import { printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function onlyGenericBlock(source: string): GenericBlockDeclarationAst {
  const result = parse(source);
  expect(result.diagnostics).toEqual([]);
  expect(greenText(result.document.syntax.green)).toBe(source);
  const [declaration] = Array.from(result.document.declarations());
  expect(declaration).toBeInstanceOf(GenericBlockDeclarationAst);
  if (!(declaration instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
  return declaration;
}

function attributeArgs(attribute: FieldAttributeAst) {
  return Array.from(attribute.argList()?.args() ?? [], (arg) => ({
    name: arg.name()?.token()?.text,
    value: StringLiteralExprAst.cast(arg.value()?.syntax ?? attribute.syntax)?.value(),
  }));
}

describe('enum member attributes', () => {
  it('parses positional and named attribute arguments on members with spans', () => {
    const source = 'enum Role {\n  USER @map("user")\n  ADMIN @map(name: "admin") @deprecated\n}';
    const block = onlyGenericBlock(source);
    const [user, admin] = Array.from(block.entries());

    expect(user?.key()?.token()?.text).toBe('USER');
    expect(user?.value()).toBeUndefined();
    const userAttributes = Array.from(user?.attributes() ?? []);
    expect(userAttributes).toHaveLength(1);
    expect(userAttributes[0]?.name()?.path()).toEqual(['map']);
    expect(attributeArgs(userAttributes[0]!)).toEqual([{ name: undefined, value: 'user' }]);
    expect(userAttributes[0]?.syntax.offset).toBe(source.indexOf('@map("user")'));
    expect(userAttributes[0]?.syntax.textLength).toBe('@map("user")'.length);

    const adminAttributes = Array.from(admin?.attributes() ?? []);
    expect(adminAttributes.map((attribute) => attribute.name()?.path())).toEqual([
      ['map'],
      ['deprecated'],
    ]);
    expect(attributeArgs(adminAttributes[0]!)).toEqual([{ name: 'name', value: 'admin' }]);
    expect(adminAttributes[1]?.argList()).toBeUndefined();
  });

  it('keeps a member value and its attributes apart', () => {
    const block = onlyGenericBlock('enum Role {\n  Admin = "admin" @map("ADMIN")\n}');
    const [admin] = Array.from(block.entries());
    expect(StringLiteralExprAst.cast(admin!.value()!.syntax)?.value()).toBe('admin');
    expect(Array.from(admin!.attributes()).map((a) => a.name()?.path())).toEqual([['map']]);
  });

  it('parses a member attribute list as FieldAttribute children of the KeyValuePair', () => {
    const result = parse('enum Role {\n  USER @map("user")\n}');
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "enum"
          Whitespace " "
          Identifier
            Ident "Role"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "USER"
            Whitespace " "
            FieldAttribute
              At "@"
              QualifiedName
                Identifier
                  Ident "map"
              AttributeArgList
                LParen "("
                AttributeArg
                  StringLiteralExpr
                    StringLiteral "\\"user\\""
                RParen ")"
          Newline "\\n"
          RBrace "}""
    `);
  });

  it('parses a bare enum block exactly as before, with no member attributes', () => {
    const source = 'enum Role {\n  ADMIN\n  USER\n}';
    const block = onlyGenericBlock(source);
    for (const entry of block.entries()) {
      expect(Array.from(entry.attributes())).toEqual([]);
    }
    expect(printTree(parse(source).document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "enum"
          Whitespace " "
          Identifier
            Ident "Role"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "ADMIN"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "USER"
          Newline "\\n"
          RBrace "}""
    `);
  });
});

describe('view blocks', () => {
  const source =
    'view ActiveUsers {\n  id    Int    @unique\n  email String @db.VarChar(255)\n  posts Post[]\n\n  @@map("active_users")\n}';

  it('parses a view with the model body grammar and keeps the view keyword', () => {
    const block = onlyGenericBlock(source);
    expect(block.keyword()?.text).toBe('view');
    expect(block.name()?.token()?.text).toBe('ActiveUsers');
    const fields = Array.from(block.fields());
    expect(fields.map((field) => field.name()?.token()?.text)).toEqual(['id', 'email', 'posts']);
    expect(fields[0]?.typeAnnotation()?.syntax.offset).toBe(source.indexOf('Int'));
    expect(Array.from(fields[1]!.attributes()).map((a) => a.name()?.path())).toEqual([
      ['db', 'VarChar'],
    ]);
    expect(Array.from(block.attributes()).map((a) => a.name()?.path())).toEqual([['map']]);
    expect(Array.from(block.entries())).toEqual([]);
  });

  it('parses a view body as FieldDeclaration children', () => {
    const result = parse('view ActiveUsers {\n  id Int @unique\n}');
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "view"
          Whitespace " "
          Identifier
            Ident "ActiveUsers"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          FieldDeclaration
            Identifier
              Ident "id"
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "Int"
            Whitespace " "
            FieldAttribute
              At "@"
              QualifiedName
                Identifier
                  Ident "unique"
          Newline "\\n"
          RBrace "}""
    `);
  });

  it('reports a malformed view member with the model-member diagnostic', () => {
    const result = parse('view ActiveUsers {\n  123\n  id Int\n}');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_MODEL_MEMBER']);
  });
});

describe('Prisma 7 spike schema', () => {
  it('parses with zero diagnostics', () => {
    // Copied from projects/prisma7-contract-source/spike/schema.prisma.
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/prisma7-spike.prisma');
    const source = readFileSync(fixture, 'utf8');
    const result = parse(source);
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const keywords = Array.from(result.document.declarations(), (declaration) =>
      declaration instanceof GenericBlockDeclarationAst ? declaration.keyword()?.text : 'model',
    );
    expect(keywords).toEqual([
      'datasource',
      'generator',
      'enum',
      'view',
      'model',
      'model',
      'model',
    ]);
  });
});
