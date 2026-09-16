import type {
  ControlDefaultLiteralTagEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';

const UNSAFE_DEFAULT_BODY = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined {
  return UNSAFE_DEFAULT_BODY.test(body)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}

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
