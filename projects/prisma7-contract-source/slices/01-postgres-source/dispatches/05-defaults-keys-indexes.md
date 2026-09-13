# Dispatch 5: defaults, `@updatedAt`, and indexes

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

> **Decision (2026-09-13, orchestrator, under the operator's standing rule "hard error on unsupported elements now, fill later"): option (a).** An ORM-side generator or `@updatedAt` on an optional field is `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`; `@default(...)` combined with `@updatedAt` is `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`. Both messages say the Prisma 8 spelling cannot express the combination yet and name the edit (drop the `?`, or drop the `@default`). No Prisma 8 PSL change in this dispatch.

## Task

Implement the Defaults and index rows of the rule table, such that every column default, ORM-side generator, unique index, and plain index Prisma 7 created is described so `db verify` reports nothing for them, and the values match `verification-results.md` items 1, 2, 3.

## Scope

In:

1. **Column defaults.** `autoincrement()` (the lowering item 1 verified), `now()` (item 2: `timestamp` codec with `typeParams.precision = 3` unless `@db.*` overrides), literals of every scalar (`Bytes` and `DateTime` literal forms quoted in `verification-results.md`), list literals, `dbgenerated("expr")` as a raw expression, and enum member defaults (the member's mapped storage value, as Prisma 7 emits `DEFAULT 'user'`).
2. **ORM-side generators.** `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid(n)`, `cuid()`, `cuid(2)` map to the execution generators the Postgres registry already has (`packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:118-160`); `cuid()` maps to `cuid2` (spec decision). No column default. On an optional field: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` (the contract would accept it, item 3, but Prisma 8 PSL cannot spell it, so the converter could not print it).
3. **`@updatedAt`.** Execution generators on create and update using the same generator `temporal.updatedAt()` uses (`INSTANT_NOW_GENERATOR_ID`), column `timestamp(3)` or the `@db.*` override, no storage default. On an optional field: `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED`. Combined with any `@default`: `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED`. Fixtures for both errors and for the accepted form, including `updated-at-timestamptz` (turn the `it.todo` into a real case).
4. **Indexes.** `@unique` and `@@unique` lower to unique indexes named `{table}_{cols}_key` (`map` overrides), `@@index` to indexes named `{table}_{cols}_idx` (`map` overrides), `type: Hash` and the other index types Prisma 8 supports map through; `sort` and `length` arguments are `PRISMA7_INDEX_ARGUMENT_UNSUPPORTED` unless Prisma 8's index IR carries them (check before deciding). The dispatch 6 integration test's filtered `unique:*` paths must now be empty.
5. Fixtures per row; update the `keys` fixture from dispatch 6 if unique lowering changes it.

Out: relations (done), Mongo, the printer.

## Completed when

- [ ] Package `test`, `typecheck`, `lint`, `build` green; `pnpm --filter @internal/sql-contract-psl test` green including the new positive tests; root typecheck green.
- [ ] `pnpm --filter integration-tests test prisma7-source` green with the relations test's filtered list reduced to nothing, or to paths you name with a reason.
- [ ] A new integration test interprets `test/integration/test/fixtures/prisma7-source/supported/schema.prisma` in full and verifies against the applied `supported/migration.sql` with zero findings (this is dispatch 8's proof brought forward; if any finding remains, list it and stop, do not filter).

## Halt conditions

- The Postgres generator registry lacks a generator Prisma 7 has (`nanoid` with a length argument, `uuid(7)`): report which; do not add a generator.
- The relaxation in part 3 breaks an existing negative interpreter test whose case must remain an error. Report the test name and stop.

## References

- `verification-results.md` items 1, 2, 3; `control-mutation-defaults.ts:47-160`; `timestamp-now-generator.ts`; `sql-attribute-specs.ts:167-272` (index and default argument shapes); `psl-field-resolution.ts:554-656`.
- Failure modes F3, F13, F14, F17, F24, F28; F5. Grep gates § Cross-cutting anti-patterns.

## Heartbeat and return shape

As dispatch 1.
