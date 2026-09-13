import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan, ResolvedAttribute } from '@internal/psl-parser';
import { ArrayLiteralAst, IdentifierAst, StringLiteralExprAst } from '@internal/psl-parser/syntax';
import type { IndexNode } from '@internal/sql-contract-ts/contract-builder';
import { prisma7Diagnostic } from './diagnostics';

/** `@@index([...])`, `@@unique([...])`, `@unique`, `@@id([...])`, `@id` as Prisma 7 spells them. */
export interface IndexAttribute {
  readonly fields: readonly string[] | undefined;
  readonly map: string | undefined;
  readonly type: string | undefined;
  readonly span: PslSpan;
}

/** Prisma 7 index type names to Prisma 8's Postgres index type literals. */
const INDEX_TYPES: Readonly<Record<string, string>> = {
  BTree: 'btree',
  Hash: 'hash',
  Gin: 'gin',
  Gist: 'gist',
  SpGist: 'spgist',
  Brin: 'brin',
};

export function parseIndexAttribute(
  attribute: ResolvedAttribute,
  owner: string,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): IndexAttribute | undefined {
  const unsupported = (what: string, span: PslSpan): undefined => {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_INDEX_ARGUMENT_UNSUPPORTED',
        `"${owner}": @${attribute.name} ${what}`,
        sourceId,
        span,
      ),
    );
    return undefined;
  };
  let fields: readonly string[] | undefined;
  let map: string | undefined;
  let type: string | undefined;
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? 'fields' : arg.name;
    const expression = arg.expression;
    switch (key) {
      case 'fields': {
        const array =
          expression === undefined ? undefined : ArrayLiteralAst.cast(expression.syntax);
        if (array === undefined) return unsupported('expects a list of field names.', arg.span);
        const names: string[] = [];
        for (const element of array.elements()) {
          const name = IdentifierAst.cast(element.syntax)?.name();
          if (name === undefined) {
            return unsupported(
              'field arguments such as sort or length are not supported; Prisma 8 indexes carry none.',
              arg.span,
            );
          }
          names.push(name);
        }
        fields = names;
        break;
      }
      case 'map':
        map =
          expression === undefined
            ? undefined
            : StringLiteralExprAst.cast(expression.syntax)?.value();
        if (map === undefined) return unsupported('map must be a string.', arg.span);
        break;
      case 'name':
        break;
      case 'type': {
        const token =
          expression === undefined ? undefined : IdentifierAst.cast(expression.syntax)?.name();
        type = token === undefined ? undefined : INDEX_TYPES[token];
        if (type === undefined) {
          return unsupported(
            `type "${token ?? ''}" is not an index type Prisma 8 supports.`,
            arg.span,
          );
        }
        break;
      }
      default:
        return unsupported(`argument "${key ?? ''}" is not supported.`, arg.span);
    }
  }
  return { fields, map, type, span: attribute.span };
}

/** Prisma 7's default index name: `{table}_{columns}_idx`, or `_key` for a unique index. */
export function defaultIndexName(
  tableName: string,
  columns: readonly string[],
  unique: boolean,
): string {
  return `${tableName}_${columns.join('_')}_${unique ? 'key' : 'idx'}`;
}

export function indexNode(
  tableName: string,
  columns: readonly string[],
  attribute: IndexAttribute,
  unique: boolean,
): IndexNode {
  return {
    columns,
    ...(attribute.type === undefined
      ? { type: undefined, options: undefined }
      : { type: attribute.type, options: {} }),
    where: undefined,
    unique: unique ? true : undefined,
    map: attribute.map ?? defaultIndexName(tableName, columns, unique),
    name: undefined,
  };
}
