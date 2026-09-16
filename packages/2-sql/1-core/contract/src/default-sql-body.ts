const UNSAFE_DEFAULT_BODY = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined {
  return UNSAFE_DEFAULT_BODY.test(body)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}
