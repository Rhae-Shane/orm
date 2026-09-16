import type { TaggedLiteralCanonicalization } from '@internal/framework-components/control';
import { canonicalizeTaggedLiteralBody } from '@internal/framework-components/control';
import { isTerminatedStringLiteral } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode, type SyntaxToken } from '../red';
import { IdentifierAst } from './identifier';
import { QualifiedNameAst } from './qualified-name';

export class FunctionCallAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  /** The qualified-name callee, or `undefined` when identifier segments sit directly under the node. */
  name(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /**
   * The dotted call path, in source order. A bare `Vector(…)` yields
   * `['Vector']`; a namespace-qualified `pgvector.Vector(…)` yields
   * `['pgvector', 'Vector']`. Empty when the call carries no identifier.
   */
  path(): readonly string[] {
    const qualified = this.name();
    const segments: string[] = [];
    for (const segment of filterChildren(qualified?.syntax ?? this.syntax, IdentifierAst.cast)) {
      const text = segment.token()?.text;
      if (text !== undefined) segments.push(text);
    }
    return segments;
  }

  lparen(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LParen');
  }

  rparen(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RParen');
  }

  *args(): Iterable<AttributeArgAst> {
    yield* filterChildren(this.syntax, AttributeArgAst.cast);
  }

  static cast(node: SyntaxNode): FunctionCallAst | undefined {
    return node.kind === 'FunctionCall' ? new FunctionCallAst(node) : undefined;
  }
}

export class ArrayLiteralAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  lbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBracket');
  }

  rbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBracket');
  }

  *elements(): Iterable<ExpressionAst> {
    yield* filterChildren(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): ArrayLiteralAst | undefined {
    return node.kind === 'ArrayLiteral' ? new ArrayLiteralAst(node) : undefined;
  }
}

const HEX = /^[0-9a-fA-F]+$/;

function decodeFixedHex(raw: string, start: number, width: number): string | undefined {
  if (start + width > raw.length) return undefined;
  const hex = raw.slice(start, start + width);
  if (!HEX.test(hex)) return undefined;
  return String.fromCharCode(Number.parseInt(hex, 16));
}

function decodeStringLiteral(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch !== '\\' || i + 1 >= raw.length) {
      out += ch;
      i++;
      continue;
    }
    const next = raw.charAt(i + 1);
    switch (next) {
      case 'n':
        out += '\n';
        i += 2;
        continue;
      case 'r':
        out += '\r';
        i += 2;
        continue;
      case 't':
        out += '\t';
        i += 2;
        continue;
      case '"':
        out += '"';
        i += 2;
        continue;
      case "'":
        out += "'";
        i += 2;
        continue;
      case '\\':
        out += '\\';
        i += 2;
        continue;
      case 'x': {
        const decoded = decodeFixedHex(raw, i + 2, 2);
        if (decoded === undefined) {
          out += '\\x';
          i += 2;
          continue;
        }
        out += decoded;
        i += 4;
        continue;
      }
      case 'u': {
        const decoded = decodeFixedHex(raw, i + 2, 4);
        if (decoded === undefined) {
          out += '\\u';
          i += 2;
          continue;
        }
        out += decoded;
        i += 6;
        continue;
      }
      default:
        out += `\\${next}`;
        i += 2;
        continue;
    }
  }
  return out;
}

export class StringLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'StringLiteral');
  }

  value(): string | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    return decodeStringLiteral(tok.text.slice(1, -1));
  }

  static cast(node: SyntaxNode): StringLiteralExprAst | undefined {
    return node.kind === 'StringLiteralExpr' ? new StringLiteralExprAst(node) : undefined;
  }
}

export type TaggedLiteralFence = 'backtick' | 'quote';

const BACKTICK_ESCAPES: ReadonlySet<string> = new Set(['`', '\\', '$']);

function resolveBacktickEscapes(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    const next = raw.charAt(i + 1);
    if (ch === '\\' && BACKTICK_ESCAPES.has(next)) {
      out += next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isTerminatedFence(text: string): boolean {
  if (text.startsWith('`')) return text.length >= 2 && text.endsWith('`');
  return isTerminatedStringLiteral(text);
}

/**
 * `tag`body`` or `tag"body"`. The tag is one or more identifiers joined by
 * dots; the fence token holds the body with its fences. `body()` is the
 * canonical text shared with the TypeScript `sql` tag.
 */
export class TaggedLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  *segments(): Iterable<IdentifierAst> {
    yield* filterChildren(this.syntax, IdentifierAst.cast);
  }

  tag(): string {
    const names: string[] = [];
    for (const segment of this.segments()) {
      const name = segment.name();
      if (name !== undefined) names.push(name);
    }
    return names.join('.');
  }

  fenceToken(): SyntaxToken | undefined {
    for (const child of this.syntax.children()) {
      if (child instanceof SyntaxNode) continue;
      if (child.kind === 'TemplateLiteral' || child.kind === 'StringLiteral') return child;
      if (child.kind === 'Invalid' && child.text.startsWith('`')) return child;
    }
    return undefined;
  }

  fence(): TaggedLiteralFence | undefined {
    const text = this.fenceToken()?.text;
    if (text === undefined) return undefined;
    return text.startsWith('`') ? 'backtick' : 'quote';
  }

  /** The text between the fences, escapes not yet resolved. */
  rawBody(): string {
    const text = this.fenceToken()?.text ?? '';
    return isTerminatedFence(text) ? text.slice(1, -1) : text.slice(1);
  }

  canonicalization(): TaggedLiteralCanonicalization {
    const raw = this.rawBody();
    const resolved =
      this.fence() === 'quote' ? decodeStringLiteral(raw) : resolveBacktickEscapes(raw);
    return canonicalizeTaggedLiteralBody(resolved);
  }

  /** The canonical body, or `undefined` when canonicalization fails. */
  body(): string | undefined {
    const result = this.canonicalization();
    return result.ok ? result.body : undefined;
  }

  static cast(node: SyntaxNode): TaggedLiteralExprAst | undefined {
    return node.kind === 'TaggedLiteral' ? new TaggedLiteralExprAst(node) : undefined;
  }
}

export class NumberLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'NumberLiteral');
  }

  value(): number | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    return Number(tok.text);
  }

  static cast(node: SyntaxNode): NumberLiteralExprAst | undefined {
    return node.kind === 'NumberLiteralExpr' ? new NumberLiteralExprAst(node) : undefined;
  }
}

export class BooleanLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  value(): boolean | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    if (tok.text === 'true') return true;
    if (tok.text === 'false') return false;
    return undefined;
  }

  static cast(node: SyntaxNode): BooleanLiteralExprAst | undefined {
    return node.kind === 'BooleanLiteralExpr' ? new BooleanLiteralExprAst(node) : undefined;
  }
}

export class ObjectLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<ObjectFieldAst> {
    yield* filterChildren(this.syntax, ObjectFieldAst.cast);
  }

  static cast(node: SyntaxNode): ObjectLiteralExprAst | undefined {
    return node.kind === 'ObjectLiteralExpr' ? new ObjectLiteralExprAst(node) : undefined;
  }
}

export class ObjectFieldAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  key(): IdentifierAst | undefined {
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Colon') break;
        continue;
      }
      return IdentifierAst.cast(child);
    }
    return undefined;
  }

  /**
   * The field's logical key name, unquoted. An identifier key (`length:`) yields
   * its text; a string-literal key (`"length":`) yields the decoded string.
   * `undefined` when the field carries no key node.
   */
  keyName(): string | undefined {
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Colon') break;
        continue;
      }
      const identifier = IdentifierAst.cast(child);
      if (identifier) return identifier.token()?.text;
      const stringKey = StringLiteralExprAst.cast(child);
      if (stringKey) return stringKey.value();
      return undefined;
    }
    return undefined;
  }

  colon(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  value(): ExpressionAst | undefined {
    if (this.colon()) {
      let pastColon = false;
      for (const child of this.syntax.children()) {
        if (!(child instanceof SyntaxNode)) {
          if (child.kind === 'Colon') pastColon = true;
          continue;
        }
        if (pastColon) {
          const expr = castExpression(child);
          if (expr) return expr;
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): ObjectFieldAst | undefined {
    return node.kind === 'ObjectField' ? new ObjectFieldAst(node) : undefined;
  }
}

export type ExpressionAst =
  | FunctionCallAst
  | ArrayLiteralAst
  | StringLiteralExprAst
  | TaggedLiteralExprAst
  | NumberLiteralExprAst
  | BooleanLiteralExprAst
  | ObjectLiteralExprAst
  | IdentifierAst;

export function castExpression(node: SyntaxNode): ExpressionAst | undefined {
  return (
    FunctionCallAst.cast(node) ??
    ArrayLiteralAst.cast(node) ??
    StringLiteralExprAst.cast(node) ??
    TaggedLiteralExprAst.cast(node) ??
    NumberLiteralExprAst.cast(node) ??
    BooleanLiteralExprAst.cast(node) ??
    ObjectLiteralExprAst.cast(node) ??
    IdentifierAst.cast(node)
  );
}

export class AttributeArgAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  colon(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  value(): ExpressionAst | undefined {
    if (this.colon()) {
      let pastColon = false;
      for (const child of this.syntax.children()) {
        if (!(child instanceof SyntaxNode)) {
          if (child.kind === 'Colon') pastColon = true;
          continue;
        }
        if (pastColon) {
          const expr = castExpression(child);
          if (expr) return expr;
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): AttributeArgAst | undefined {
    return node.kind === 'AttributeArg' ? new AttributeArgAst(node) : undefined;
  }
}
