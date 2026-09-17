import { checkSqlDefaultBody } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createBuiltinLikeControlMutationDefaults } from '../../2-authoring/contract-psl/test/fixtures';
import { sqlDefaultLiteralTagEntry } from '../src/core/sql-default-literal-tag';

const span = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 5, line: 1, column: 6 },
} as const;
const context = { sourceId: 'schema.prisma', modelName: 'T', fieldName: 'id' } as const;
const nowEntry = {
  lower: () => ({
    ok: true as const,
    value: {
      kind: 'storage' as const,
      defaultValue: { kind: 'function' as const, expression: 'now()' },
    },
  }),
};
const registries = {
  defaultFunctionRegistry: new Map([['now', nowEntry]]),
  defaultLiteralTagRegistry: new Map(),
};
const REJECTION =
  'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.';

describe('checkSqlDefaultBody', () => {
  it.each([
    ['gen_random_uuid()'],
    ["(now() + '00:03:00'::interval)"],
    ["'{}'::text[]"],
    ['CURRENT_TIMESTAMP'],
    ['selected_at'],
    [''],
  ])('accepts %j', (body) => {
    expect(checkSqlDefaultBody(body)).toBeUndefined();
  });

  it.each([
    ['a semicolon', "eek(); DROP TABLE 'x'"],
    ['a line comment', 'now() -- x'],
    ['a block comment', 'now() /* x */'],
    ['dollar quoting', '$$x$$'],
    ['a subquery', '(select 1)'],
    ['an upper-case subquery', '(SELECT 1)'],
    ['the word select inside a SQL string literal', "'no select here'"],
  ])('rejects %s', (_name, body) => {
    expect(checkSqlDefaultBody(body)).toBe(REJECTION);
  });
});

describe('sqlDefaultLiteralTagEntry', () => {
  const entry = sqlDefaultLiteralTagEntry('pg.sql`...`');

  it('records its usage and documentation', () => {
    expect(entry.usage).toBe('pg.sql`...`');
    expect(entry.documentation).toBe(
      "Uses the SQL between the fences, verbatim, as the column's default expression.",
    );
  });

  it('lowers the body verbatim as a function default', () => {
    const body = "(now() + '00:03:00'::interval)";
    expect(entry.lower({ literal: { tag: 'pg.sql', body, span }, context, registries })).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: body } },
    });
  });

  it('lowers an empty body without a diagnostic', () => {
    expect(entry.lower({ literal: { tag: 'sql', body: '', span }, context, registries })).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: '' } },
    });
  });

  it('refuses a body that only spells a registered default function', () => {
    expect(
      entry.lower({ literal: { tag: 'sql', body: ' now() ', span }, context, registries }),
    ).toEqual({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message:
          'Write @default(now()) instead of sql`now()`; the named form is the one Prisma understands.',
        sourceId: 'schema.prisma',
        span,
      },
    });
  });

  it('accepts a body that uses a registered function inside a larger expression', () => {
    expect(
      entry.lower({
        literal: { tag: 'sql', body: "now() + interval '1 day'", span },
        context,
        registries,
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts a bare call that is not a registered function', () => {
    expect(
      entry.lower({ literal: { tag: 'sql', body: 'random()', span }, context, registries }),
    ).toMatchObject({ ok: true });
  });

  it('reports a rejected body as PSL_INVALID_DEFAULT_SQL at the literal', () => {
    expect(
      entry.lower({ literal: { tag: 'sql', body: 'x; y', span }, context, registries }),
    ).toEqual({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: REJECTION,
        sourceId: 'schema.prisma',
        span,
      },
    });
  });
});

describe('the contract-psl fixture registry mirrors the family entry', () => {
  const fixtureEntry =
    createBuiltinLikeControlMutationDefaults().defaultLiteralTagRegistry.get('sql');
  const familyEntry = sqlDefaultLiteralTagEntry('sql`...`');

  it.each([['x; y'], ['now()'], ['random()'], ["'no select here'"], ['']])(
    'lowers %j the same way',
    (body) => {
      expect(
        fixtureEntry?.lower({ literal: { tag: 'sql', body, span }, context, registries }),
      ).toEqual(familyEntry.lower({ literal: { tag: 'sql', body, span }, context, registries }));
    },
  );
});
