const UNSAFE_DEFAULT_BODY = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Client-side Prisma generators that authors often paste into raw SQL defaults by mistake. */
const CLIENT_GENERATOR_CALL = /^\s*(?:[A-Za-z_][\w$]*\.)?(nanoid|uuid|cuid|ulid)\s*\([^;]*\)\s*$/i;

/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined {
  return UNSAFE_DEFAULT_BODY.test(body)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}

/**
 * Names the Prisma default function a raw SQL body spells exactly, ignoring surrounding whitespace. The planners treat the contract expressions `now()` and `autoincrement()` as those functions, so a raw body with that text would not be used as written.
 */
export function reservedSqlDefaultBody(body: string): 'now' | 'autoincrement' | undefined {
  switch (body.trim()) {
    case 'now()':
      return 'now';
    case 'autoincrement()':
      return 'autoincrement';
    default:
      return undefined;
  }
}

/**
 * When a raw SQL default is a bare call to a Prisma client-side generator (`nanoid`, `uuid`,
 * `cuid`, `ulid`), returns that name. Migrate would emit `DEFAULT (nanoid(16))` without creating
 * the function; authors almost always meant `@default(nanoid(16))` instead.
 */
export function clientGeneratorSqlDefaultBody(body: string): string | undefined {
  const match = CLIENT_GENERATOR_CALL.exec(body);
  return match?.[1]?.toLowerCase();
}

/** Fix hint shared by PSL and TypeScript when {@link clientGeneratorSqlDefaultBody} matches. */
export function clientGeneratorSqlDefaultMessage(options: {
  readonly generator: string;
  readonly body: string;
  readonly namedForm: string;
}): string {
  return (
    `Raw SQL default "${options.body.trim()}" looks like Prisma's client-side ${options.generator}() generator. ` +
    `Write ${options.namedForm} so Prisma generates the value before insert, ` +
    'or declare a Postgres function entity and call a database function name that is not a Prisma generator ' +
    '(for example app_nanoid(16); naming around client generators is an MVP constraint). ' +
    'Migrate does not create a function from this expression alone.'
  );
}
