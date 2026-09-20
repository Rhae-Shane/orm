import type { ColumnDefault } from '@internal/contract/types';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  resolveTemplateTagEscapes,
} from '@internal/framework-components/control';
import {
  checkSqlDefaultBody,
  clientGeneratorSqlDefaultBody,
  clientGeneratorSqlDefaultMessage,
  reservedSqlDefaultBody,
} from '@internal/sql-contract/validators';
import { contractError } from './contract-errors';

/**
 * A raw SQL column default written as a template literal: `` sql`gen_random_uuid()` ``. The raw text
 * between the backticks resolves `` \` ``, `\\` and `\$`, is canonicalized the way PSL canonicalizes a
 * tagged literal, and is used verbatim as the default expression. Interpolation is not supported, so
 * the two characters `${` are written `\${`.
 */
export function sql(strings: TemplateStringsArray, ...values: readonly never[]): ColumnDefault {
  if (values.length > 0) {
    throw contractError(
      'CONTRACT.DEFAULT_SQL_INTERPOLATION',
      'sql`...` does not support interpolation; write the SQL as one literal.',
      { meta: { interpolations: values.length } },
    );
  }
  const canonical = canonicalizeTaggedLiteralBody(resolveTemplateTagEscapes(strings.raw.join('')));
  if (!canonical.ok) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      describeTaggedLiteralFailure(canonical.reason),
      {
        meta: { reason: canonical.reason, offset: canonical.offset },
      },
    );
  }
  const reserved = reservedSqlDefaultBody(canonical.body);
  if (reserved !== undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `Write .default(${reserved}()) instead of sql\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`,
      { meta: { reason: 'reserved-function', expression: canonical.body } },
    );
  }
  const clientGenerator = clientGeneratorSqlDefaultBody(canonical.body);
  if (clientGenerator !== undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR',
      clientGeneratorSqlDefaultMessage({
        generator: clientGenerator,
        body: canonical.body,
        namedForm: `.default(${canonical.body.trim()})`,
      }),
      {
        meta: {
          reason: 'client-generator',
          expression: canonical.body,
          generator: clientGenerator,
        },
      },
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
