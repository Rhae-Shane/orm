import { postgresError } from '../../errors';
import type { PostgresFunctionVolatility } from '../../postgres-function';
import { qualifyName, quoteIdentifier } from '../../sql-utils';
import { boundSchema } from '../bound-schema';
import { type Op, step, targetDetails } from './shared';

const BODY_DOLLAR_TAG = 'prisma_fn';

function qualifiedFunctionName(schemaName: string, functionName: string): string {
  const schema = boundSchema(schemaName);
  return schema === undefined ? quoteIdentifier(functionName) : qualifyName(schema, functionName);
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
 */
export function dropFunction(options: {
  readonly schemaName: string;
  readonly functionName: string;
  readonly signature: string;
}): Op {
  const name = qualifiedFunctionName(options.schemaName, options.functionName);
  const sql = `DROP FUNCTION ${name}(${options.signature});`;
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
