# Dispatch 2: pin verification items 1, 2, 3

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Pin three facts with tests, such that the rule table's rows for `autoincrement()`, `now()`, and execution generators are written against verified behaviour and not against the spec's assumptions.

The facts:

1. **Item 1.** What Prisma 8's `autoincrement()` column default lowers to, and whether `db verify` reports zero findings when the live column is Prisma 7's `SERIAL` column (a `nextval('"…_id_seq"'::regclass)` default) from `reference/migration.sql`.
2. **Item 2.** Whether a Prisma 8 `@default(now())` column verifies with zero findings against Prisma 7's `DEFAULT CURRENT_TIMESTAMP` column from the same SQL.
4. **Item 7.** Whether lenient `db verify` (the default mode) reports zero findings when the database has an extra table, an extra column on a declared table, and an extra foreign key from a declared table to an undeclared one, none of which the contract mentions. This is what `@ignore` and `@@ignore` rely on, since Prisma 7 still creates that schema (`CREATE TABLE "LegacyThing"`, `"legacyOwnerId"`, `Post_legacyOwnerId_fkey` in the reference SQL).
3. **Item 3.** Whether the SQL contract validator (`packages/2-sql/1-core/contract`) accepts (a) a column with both a storage default and execution generators on create and update, and (b) execution generators on a nullable column. This is a validator fact, not a PSL fact: build the contract with the TypeScript contract builder or a hand-authored contract object, never through PSL.

## Scope

In:

- Integration tests for items 1 and 2 under `test/integration/test/prisma7-source/` (new directory), using `withDevDatabase` from `@repo/test-utils` and `withClient` to apply the minimal `CREATE TABLE` statements extracted from `test/integration/test/fixtures/prisma7-source/reference/migration.sql` (copy only the statements needed; cite the source file in the test). Author the expected contract with Prisma 8's own surface (PSL through `validateSqlContractFully` or the TypeScript builder), run the same verify path `db verify` uses, and assert the exact findings list. Each test's name states the fact it pins, positively or negatively, for example `autoincrement() verifies against a SERIAL column with zero findings`.
- A unit test for item 3 in `packages/2-sql/1-core/contract/test/`.
- Fill the **Item 1**, **Item 2**, **Item 3**, **Item 7** sections of `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` with the answer, the test path, and the exact finding text if there was one.

Out:

- Any production code change. If a fact comes out contrary to the spec's assumption, that is a halt, not a fix.
- The interpreter, the package, the parser.

## Completed when

- [ ] Four tests exist, each named for the fact it pins, and all pass under `pnpm test:integration -- prisma7-source` and `pnpm --filter @internal/sql-contract test` (confirm the actual package name with `cat packages/2-sql/1-core/contract/package.json`).
- [ ] Each test fails when its claim is removed: for items 1 and 2, changing the applied SQL's default changes the findings; for item 3, removing the generator changes the validator verdict. Say how you checked (F13).
- [ ] `verification-results.md` items 1, 2, 3, 7 are filled.

## Halt conditions

- A fact contradicts the spec's assumption (the spec assumes: `autoincrement()` and `now()` verify equal; the validator accepts both combinations; lenient verify tolerates extra table, column, and foreign key). Write the finding into `verification-results.md`, commit, and stop with a report. Do not change production code to make it pass.
- The verify path cannot be driven from a test without the CLI. Look at `test/integration/test/cli.db-sign.e2e.test.ts` and `journey-test-helpers.ts` (`runDbSign`, `runOnEngine`) first; using the CLI engine in-process is acceptable.

## References

- `test/utils/src/exports/index.ts` (`withDevDatabase`, `withClient`), `test/integration/test/cli.db-sign.e2e.test.ts`, `packages/2-sql/9-family/src/core/diff/schema-verify.ts`, `packages/2-sql/1-core/schema-ir/src/ir/sql-column-default-ir.ts` (how defaults compare).
- `.agents/rules/typed-contract-in-tests.mdc`, `.agents/rules/no-contract-data-patching-in-tests.mdc`, `.agents/rules/running-tests.mdc`, `.agents/rules/use-timeouts-helper-in-tests.mdc`.
- Failure modes F3, F13, F14, F24, F28 in `drive/calibration/failure-modes.md`. Destructive git operations forbidden (F5).

## Heartbeat and return shape

As dispatch 1.
