import type { ColumnDefault } from '@internal/contract/types';
import { canonicalizeTaggedLiteralBody } from '@internal/framework-components/control';
import { checkSqlDefaultBody } from '@internal/sql-contract/validators';
import { contractError } from './contract-errors';

const CANONICALIZATION_FAILURES = {
  interpolation: 'the body contains `${`',
  nul: 'the body contains a NUL character',
  'too-large': 'the body exceeds 65536 bytes',
} as const;

/**
 * A raw SQL column default written as a template literal: `sql`gen_random_uuid()``. The body is
 * canonicalized the way PSL canonicalizes `@default(sql`...`)` and then used verbatim as the
 * default expression. Interpolation is not supported.
 */
export function sql(strings: TemplateStringsArray, ...values: readonly never[]): ColumnDefault {
  if (values.length > 0) {
    throw contractError(
      'CONTRACT.DEFAULT_SQL_INTERPOLATION',
      'sql`...` does not support interpolation; write the SQL as one literal.',
      { meta: { interpolations: values.length } },
    );
  }
  const canonical = canonicalizeTaggedLiteralBody(strings.join(''));
  if (!canonical.ok) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `sql\`...\` default rejected: ${CANONICALIZATION_FAILURES[canonical.reason]}.`,
      { meta: { reason: canonical.reason, offset: canonical.offset } },
    );
  }
  const rejected = checkSqlDefaultBody(canonical.body);
  if (rejected !== undefined) {
    throw contractError('CONTRACT.DEFAULT_INVALID', rejected, {
      meta: { reason: 'unsafe-sql', expression: canonical.body },
    });
  }
  return { kind: 'function', expression: canonical.body };
}
