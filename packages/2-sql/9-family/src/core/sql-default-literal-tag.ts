import type {
  ControlDefaultLiteralTagEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { checkSqlDefaultBody } from '@internal/sql-contract/validators';

/** A `` @default(sql`...`) `` body the SQL family refuses to lower. */
export const PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL';

const BARE_CALL = /^([A-Za-z_][A-Za-z0-9_]*)\(\)$/;

/**
 * The `` sql`...` `` default literal every SQL target registers: the canonical body becomes the
 * expression verbatim. A body that only spells a registered default function, `now()` for
 * example, is refused so the named form is written instead.
 */
export function sqlDefaultLiteralTagEntry(usage: string): ControlDefaultLiteralTagEntry {
  return {
    usage,
    documentation: "Uses the SQL between the fences, verbatim, as the column's default expression.",
    lower: ({ literal, context, registries }): LoweredDefaultResult => {
      const reject = (message: string): LoweredDefaultResult => ({
        ok: false,
        diagnostic: {
          code: PSL_INVALID_DEFAULT_SQL,
          message,
          sourceId: context.sourceId,
          span: literal.span,
        },
      });
      const namedFunction = BARE_CALL.exec(literal.body.trim())?.[1];
      if (namedFunction !== undefined && registries.defaultFunctionRegistry.has(namedFunction)) {
        return reject(
          `Write @default(${namedFunction}()) instead of sql\`${namedFunction}()\`; the named form is the one Prisma understands.`,
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
