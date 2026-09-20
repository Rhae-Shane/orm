import type {
  ControlDefaultLiteralTagEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import {
  checkSqlDefaultBody,
  clientGeneratorSqlDefaultBody,
  clientGeneratorSqlDefaultMessage,
  reservedSqlDefaultBody,
} from '@internal/sql-contract/validators';

/** A `` @default(sql`...`) `` body the SQL family refuses to lower. */
export const PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL';

/** A raw SQL default that looks like a Prisma client-side ID generator. */
export const PSL_RAW_DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR: ContributedPslDiagnosticCode =
  'PSL_RAW_DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR';

/**
 * The `` sql`...` `` default literal every SQL target registers: the canonical body becomes the expression verbatim. A body that is exactly `now()` or `autoincrement()` is refused so the named form is written instead. A bare call to a client generator (`nanoid`, `uuid`, `cuid`, `ulid`) is refused so authors do not confuse it with a database function.
 */
export function sqlDefaultLiteralTagEntry(usage: string): ControlDefaultLiteralTagEntry {
  return {
    usage,
    documentation: "Uses the SQL in the string, verbatim, as the column's default expression.",
    lower: ({ literal, context }): LoweredDefaultResult => {
      const reject = (
        message: string,
        code: ContributedPslDiagnosticCode = PSL_INVALID_DEFAULT_SQL,
      ): LoweredDefaultResult => ({
        ok: false,
        diagnostic: {
          code,
          message,
          sourceId: context.sourceId,
          span: literal.span,
        },
      });
      const reserved = reservedSqlDefaultBody(literal.body);
      if (reserved !== undefined) {
        return reject(
          `Write @default(${reserved}()) instead of ${literal.tag}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`,
        );
      }
      const clientGenerator = clientGeneratorSqlDefaultBody(literal.body);
      if (clientGenerator !== undefined) {
        return reject(
          clientGeneratorSqlDefaultMessage({
            generator: clientGenerator,
            body: literal.body,
            namedForm: `@default(${literal.body.trim()})`,
          }),
          PSL_RAW_DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR,
        );
      }
      const reason = checkSqlDefaultBody(literal.body);
      if (reason !== undefined) return reject(reason);
      return {
        ok: true,
        value: {
          kind: 'storage',
          defaultValue: { kind: 'function', expression: literal.body },
        },
      };
    },
  };
}
