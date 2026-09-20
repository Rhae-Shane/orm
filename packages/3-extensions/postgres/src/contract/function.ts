import { PostgresFunction, type PostgresFunctionVolatility } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { postgresError } from '../errors';

export interface PgFunctionHandle {
  readonly entityKind: 'function';
  readonly name: string;
  readonly entity: PostgresFunction;
  readonly namespaceId?: string;
}

/**
 * Declares a managed Postgres function for the `entities` list. Migrate plans
 * `CREATE FUNCTION` / `DROP FUNCTION` only — body or signature changes are not
 * migrated yet (drop and recreate). The body is opaque SQL Prisma does not
 * validate. Overloaded names are unsupported (one physical name per namespace).
 * Column defaults that call the function stay raw SQL (for example
 * `` sql`app_nanoid(16)` ``).
 */
export function pgFunction(input: {
  readonly name: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language?: string;
  readonly volatility?: PostgresFunctionVolatility;
  readonly namespaceId?: string;
  /** Overrides the Postgres function name; defaults to `name`. */
  readonly functionName?: string;
}): PgFunctionHandle {
  if (input.name.trim().length === 0) {
    throw postgresError('CONTRACT.ENUM_INVALID', 'pgFunction(): name must be a non-empty string.', {
      fix: 'Pass a non-empty entity name.',
      meta: { reason: 'empty name' },
    });
  }
  const functionName = input.functionName ?? input.name;
  if (functionName.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ENUM_INVALID',
      `pgFunction("${input.name}"): functionName must be a non-empty string.`,
      { fix: 'Pass a non-empty Postgres function name.', meta: { reason: 'empty functionName' } },
    );
  }
  if (input.signature.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ENUM_INVALID',
      `pgFunction("${input.name}"): signature must be a non-empty string.`,
      {
        fix: 'Pass the argument list, e.g. "size int DEFAULT 16".',
        meta: { reason: 'empty signature' },
      },
    );
  }
  if (input.returns.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ENUM_INVALID',
      `pgFunction("${input.name}"): returns must be a non-empty string.`,
      { fix: 'Pass a return type, e.g. "text".', meta: { reason: 'empty returns' } },
    );
  }
  if (input.body.trim().length === 0) {
    throw postgresError(
      'CONTRACT.ENUM_INVALID',
      `pgFunction("${input.name}"): body must be a non-empty string.`,
      {
        fix: 'Pass the function body without surrounding dollar quotes.',
        meta: { reason: 'empty body' },
      },
    );
  }

  return {
    entityKind: 'function',
    name: input.name,
    ...ifDefined('namespaceId', input.namespaceId),
    entity: new PostgresFunction({
      functionName,
      signature: input.signature,
      returns: input.returns,
      body: input.body,
      ...ifDefined('language', input.language),
      ...ifDefined('volatility', input.volatility),
    }),
  };
}
