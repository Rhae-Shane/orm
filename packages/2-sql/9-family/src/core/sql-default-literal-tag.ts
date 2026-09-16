import type {
  ControlDefaultLiteralTagEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';
import { checkSqlDefaultBody } from '@internal/sql-contract/validators';

/** The `sql`...`` default literal every SQL target registers: the canonical body becomes the expression verbatim. */
export function sqlDefaultLiteralTagEntry(usage: string): ControlDefaultLiteralTagEntry {
  return {
    usage,
    lower: ({ literal, context }): LoweredDefaultResult => {
      const reason = checkSqlDefaultBody(literal.body);
      if (reason !== undefined) {
        return {
          ok: false,
          diagnostic: {
            code: 'PSL_INVALID_DEFAULT_SQL',
            message: reason,
            sourceId: context.sourceId,
            span: literal.span,
          },
        };
      }
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
