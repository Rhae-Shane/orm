# Dispatch 5: defaults, `@updatedAt`, and indexes

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

> **Operator decision pending.** The `@updatedAt`-on-optional and `@default(now()) @updatedAt` rows below are written for option (b) from `design-notes.md` § Open questions. If the operator chooses (a), replace those two rows with the hard error `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` and skip part 3. Do not start this dispatch until the orchestrator confirms which.

## Task

Implement the Defaults and index rows of the rule table, such that every column default, ORM-side generator, unique index, and plain index Prisma 7 created is described so `db verify` reports nothing for them, and the values match `verification-results.md` items 1, 2, 3.

## Scope

In:

1. **Column defaults.** `autoincrement()` (the lowering item 1 verified), `now()` (item 2: `timestamp` codec with `typeParams.precision = 3` unless `@db.*` overrides), literals of every scalar (`Bytes` and `DateTime` literal forms quoted in `verification-results.md`), list literals, `dbgenerated("expr")` as a raw expression, and enum member defaults (the member's mapped storage value, as Prisma 7 emits `DEFAULT 'user'`).
2. **ORM-side generators.** `uuid()`, `uuid(4)`, `uuid(7)`, `ulid()`, `nanoid(n)`, `cuid()`, `cuid(2)` map to the execution generators the Postgres registry already has (`packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:118-160`); `cuid()` maps to `cuid2` (spec decision). No column default. Allowed on optional fields (item 3 verified the contract accepts it; do not route through `contract-ts`'s `build-contract.ts` nullable check).
3. **`@updatedAt`.** Execution generators on create and update using the same generator `temporal.updatedAt()` uses (`INSTANT_NOW_GENERATOR_ID`), column `timestamp(3)` or the `@db.*` override, no storage default when `@updatedAt` is alone, and the storage default `now()` kept when `@default(now())` is also present. Optional fields allowed. Then relax the Prisma 8 PSL interpreter so the converter can print these later: in `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts`, `PSL_PRESET_AND_DEFAULT_CONFLICT` no longer fires when the preset contributes no storage default, and `PSL_PRESET_NOT_OPTIONAL` no longer fires for `temporal.timestamp` / `temporal.timestamptz` presets; the generator-on-optional rejection at lines 619-656 is likewise lifted. Each relaxation gets a positive interpreter test and keeps its existing negative test for the cases that remain errors. Separate commit, message says it is a Prisma 8 authoring change.
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
