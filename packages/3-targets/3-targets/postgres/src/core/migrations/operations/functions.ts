import { postgresError } from '../../errors';
import type { PostgresFunctionVolatility } from '../../postgres-function';
import { qualifyName, quoteIdentifier } from '../../sql-utils';
import { boundSchema } from '../bound-schema';
import { type Op, step, targetDetails } from './shared';

const BODY_DOLLAR_TAG = 'prisma_fn';

const ARG_MODE = /^(IN|OUT|INOUT|VARIADIC)\b/i;

/** Tag body in `$tag$…$tag$` — empty tag is `$$…$$`. */
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Postgres identifier characters, including non-ASCII letters (SQL Unicode). */
function isPostgresIdentifierChar(ch: string): boolean {
  return /[\p{L}\p{N}_$]/u.test(ch);
}

function qualifiedFunctionName(schemaName: string, functionName: string): string {
  const schema = boundSchema(schemaName);
  return schema === undefined ? quoteIdentifier(functionName) : qualifyName(schema, functionName);
}

/**
 * If `text` starts a Postgres dollar-quote at `index`, returns the index just
 * past the closing delimiter; otherwise `undefined`.
 * Delimiters immediately after an identifier character (e.g. `foo$tag$`) are
 * not dollar quotes.
 */
function skipDollarQuoted(text: string, index: number): number | undefined {
  if (text[index] !== '$') return undefined;
  if (index > 0 && isPostgresIdentifierChar(text[index - 1]!)) return undefined;
  const open = DOLLAR_TAG.exec(text.slice(index));
  if (open === null) return undefined;
  const closer = open[0];
  const contentStart = index + closer.length;
  const closeAt = text.indexOf(closer, contentStart);
  if (closeAt < 0) return text.length;
  return closeAt + closer.length;
}

function splitTopLevelArgs(signature: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i]!;
    if (quote !== null) {
      if (ch === quote) {
        if ((quote === "'" || quote === '"') && signature[i + 1] === quote) {
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    const afterDollar = skipDollarQuoted(signature, i);
    if (afterDollar !== undefined) {
      i = afterDollar - 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ',' && depth === 0) {
      args.push(signature.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = signature.slice(start).trim();
  if (last !== '' || args.length > 0) args.push(last);
  return args.filter((arg) => arg !== '');
}

function stripDefaultClause(arg: string): string {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]!;
    if (quote !== null) {
      if (ch === quote) {
        if ((quote === "'" || quote === '"') && arg[i + 1] === quote) {
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    const afterDollar = skipDollarQuoted(arg, i);
    if (afterDollar !== undefined) {
      i = afterDollar - 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (ch === '=') return arg.slice(0, i).trim();
    // Require a left token boundary so identifiers like `mydefault` are not cut.
    if ((i === 0 || !isPostgresIdentifierChar(arg[i - 1]!)) && /^DEFAULT\b/i.test(arg.slice(i))) {
      return arg.slice(0, i).trim();
    }
  }
  return arg.trim();
}

/**
 * Normalize a CREATE FUNCTION argument-list declaration into the form Postgres
 * accepts for DROP FUNCTION: defaults and modes removed, OUT args omitted.
 * Argument names and full type expressions are kept so unnamed multi-word types
 * are not mangled.
 */
export function functionIdentitySignature(declarationSignature: string): string {
  const trimmed = declarationSignature.trim();
  if (trimmed === '') return '';

  const types: string[] = [];
  for (const rawArg of splitTopLevelArgs(trimmed)) {
    let body = stripDefaultClause(rawArg);
    if (body === '') continue;

    const modeMatch = ARG_MODE.exec(body);
    let mode = 'IN';
    if (modeMatch) {
      mode = modeMatch[1]!.toUpperCase();
      body = body.slice(modeMatch[0].length).trim();
    }
    if (mode === 'OUT' || body === '') continue;

    types.push(body);
  }
  return types.join(', ');
}

function renderCreateFunctionSql(options: {
  readonly schemaName: string;
  readonly functionName: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language: string;
  readonly volatility: PostgresFunctionVolatility;
}): string {
  if (options.body.includes(`$${BODY_DOLLAR_TAG}$`)) {
    throw postgresError(
      'CONTRACT.IDENTIFIER_INVALID',
      `Function body for "${options.functionName}" must not contain the delimiter $${BODY_DOLLAR_TAG}$.`,
      { meta: { functionName: options.functionName, reason: 'dollar-tag-collision' } },
    );
  }
  const name = qualifiedFunctionName(options.schemaName, options.functionName);
  // CREATE (not OR REPLACE): body/signature edits are planner conflicts until a
  // dedicated replace/alter path exists. Authors must drop and recreate.
  return [
    `CREATE FUNCTION ${name}(${options.signature})`,
    `RETURNS ${options.returns}`,
    `LANGUAGE ${options.language} ${options.volatility}`,
    `AS $${BODY_DOLLAR_TAG}$`,
    options.body,
    `$${BODY_DOLLAR_TAG}$;`,
  ].join('\n');
}

/** `CREATE FUNCTION` for a managed Postgres function entity. */
export function createFunction(options: {
  readonly schemaName: string;
  readonly functionName: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language: string;
  readonly volatility: PostgresFunctionVolatility;
}): Op {
  const sql = renderCreateFunctionSql(options);
  return {
    id: `createFunction.${options.functionName}`,
    label: `Create function "${options.functionName}"`,
    operationClass: 'additive',
    target: targetDetails('type', options.functionName, options.schemaName),
    precheck: [],
    execute: [step(`create function "${options.functionName}"`, sql, [])],
    postcheck: [],
  };
}

/**
 * `DROP FUNCTION` for an unclaimed managed Postgres function.
 * Control policy / ownership must suppress this for `external` /
 * `tolerated` / `observed` subjects and for entities another space owns.
 *
 * `signature` may be the CREATE declaration; DROP SQL uses the normalized
 * {@link functionIdentitySignature} form (defaults/modes stripped, OUT omitted).
 */
export function dropFunction(options: {
  readonly schemaName: string;
  readonly functionName: string;
  readonly signature: string;
}): Op {
  const name = qualifiedFunctionName(options.schemaName, options.functionName);
  const identity = functionIdentitySignature(options.signature);
  const sql = `DROP FUNCTION ${name}(${identity});`;
  return {
    id: `dropFunction.${options.functionName}`,
    label: `Drop function "${options.functionName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', options.functionName, options.schemaName),
    precheck: [],
    execute: [step(`drop function "${options.functionName}"`, sql, [])],
    postcheck: [],
  };
}
