# Slice 1: Prisma 7 contract source for Postgres — Dispatch plan

**Spec:** `projects/prisma7-contract-source/slices/01-postgres-source/spec.md`
**Linear:** to be created.

Nine dispatches, sequential. The first two establish ground truth from Prisma 7 itself and pin the facts the rule table depends on; nothing in the rule table is implemented before its fact is pinned. Every dispatch is test-first. Dispatch briefs are numbered files under `dispatches/`.

Calibration threaded into every brief: `drive/calibration/failure-modes.md` F3 (discover with grep, not by running suites), F13 (a regression test must discriminate), F14 (gates mirror CI: run `pnpm lint` per package, typecheck must cover `test/`), F16 (no self-acknowledged layering violations), F24 (stale `dist` looks like a broken base; rebuild the producing package), F28 (a test file no runner invokes is not coverage); `drive/calibration/grep-library.md` § Cross-cutting anti-patterns (no `any`, no file-extension imports, no `@ts-expect-error` outside type tests, no `projects/` references in long-lived files).

### Dispatch 1: Prisma 7 ground truth

- **Outcome:** A committed fixture directory holds a Prisma 7 schema exercising every scalar, every Postgres `@db.*` native type Prisma 7 documents, native enums with `@map`s, `@updatedAt`, every default function, explicit relations with and without actions, an implicit many-to-many, and `multiSchema`; beside it the exact SQL Prisma 7.10.0 generates for that schema, and a README recording the command that produced it.
- **Builds on:** nothing.
- **Hands to:** the Prisma 7 native type table as data (verification item 6), the implicit junction shape at 7.10.0 (verification item 4), the `reference/` SQL as ground truth, and the `supported/` SQL that dispatches 2 and 8 apply to PGlite.
- **Focus:** generate with `pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema-datamodel <schema> --script` from a scratch directory under `wip/` (outside the workspace globs, so the lockfile is untouched). Commit only the schema, the SQL, and the README under `test/integration/test/fixtures/prisma7-source/`. Also record, from the Prisma changelog, the version that switched implicit junctions from a unique index to a primary key.
- **Gates:** the SQL file exists and contains a `CREATE TABLE "_"` junction; `rg -n "prisma@|@prisma/" pnpm-lock.yaml` shows no new Prisma 7 entries; README present.

### Dispatch 2: pin verification items 1, 2, 3

- **Outcome:** Tests state, by name, what Prisma 8's `autoincrement()` and `now()` lower to and whether they verify equal against the `SERIAL` and `CURRENT_TIMESTAMP` columns in dispatch 1's SQL; and whether the SQL contract validator accepts a column default alongside execution generators and execution generators on nullable columns.
- **Builds on:** dispatch 1's SQL.
- **Hands to:** `verification-results.md` in the slice folder with each fact's answer, so the orchestrator amends the rule table if a fact contradicts the spec.
- **Focus:** integration tests under `test/integration/test/` that apply the relevant SQL to `withDevDatabase`, then run verify against a contract authored the Prisma 8 way; a unit test in `packages/2-sql/1-core/contract` for the validator facts.
- **Gates:** the tests pass; `verification-results.md` written. **Halt** if any fact contradicts the spec's assumption; report instead of working around it.

### Dispatch 3: parser grammar additions

- **Outcome:** `@internal/psl-parser` parses attributes on enum members and field lines inside `view` blocks, with spans, and its existing tests still pass.
- **Builds on:** nothing (may follow dispatch 2 for review coherence only).
- **Hands to:** a syntax tree the interpreter can walk for Prisma 7 enums and views.
- **Focus:** the grammar in `packages/1-framework/2-authoring/psl-parser/src/parse.ts` and the typed AST classes; tests first.
- **Gates:** `pnpm --filter @internal/psl-parser test`, `typecheck`, `lint` green; the spike schema under `projects/prisma7-contract-source/spike/schema.prisma` parses with zero diagnostics.

### Dispatch 4: package, config, and the structural interpreter

- **Outcome:** `packages/2-sql/2-authoring/contract-prisma7` exists; `prisma7Schema(path)` returns a `ContractConfig`; `defineConfig({ contract: prisma7Schema(...) })` type-checks in `@prisma/orm-postgres/config`; the interpreter handles the Blocks, Naming, and Field types sections of the slice spec (models, fields, scalars, `@db.*` from dispatch 1's table, lists, native enums, namespaces, `@ignore`, `@@ignore`, provider check, `relationMode`, `view`, `Unsupported`, unmapped native types) and every produced contract passes `validateContract`.
- **Builds on:** dispatches 1 and 3.
- **Hands to:** a loading, validating source with a fixture harness the remaining dispatches extend.
- **Focus:** package layout per `vite-plugin-contract-emit`; `architecture.config.json` needed no entry (the `packages/2-sql/2-authoring/**` glob covers it), but the publish-surface shell map did; `packages/3-extensions/postgres/src/config/define-config.ts`; fixtures under the package's `test/fixtures/` with one `.prisma` per rule row and expected diagnostics for error rows.
- **Gates:** package `test`, `typecheck`, `lint`; `pnpm lint:deps`; `pnpm --filter @prisma/orm-postgres typecheck` after building the new package.

### Dispatch 5: defaults, keys, uniques, indexes

- **Outcome:** Every row of the spec's Defaults and Keys sections is implemented and fixtured, with the answers from `verification-results.md` applied.
- **Builds on:** dispatches 2 and 4.
- **Hands to:** contracts whose column defaults, generators, and index names match Prisma 7.
- **Gates:** as dispatch 4.

### Dispatch 6: relations

_Order change 2026-09-13: dispatch 6 runs before dispatch 5, which is blocked on the operator's `@updatedAt` decision. Dispatch 6 builds on dispatch 4 only._

- **Outcome:** Explicit relations carry Prisma 7's effective actions; implicit many-to-many relations produce the junction model from dispatch 1's SQL; back-relations resolve through the existing pairing code, decoupled from `FieldSymbol`.
- **Builds on:** dispatch 4.
- **Hands to:** the relation rows of the rule table; dispatch 5 completes it.
- **Focus:** the Prisma 7 relation rules on top of `contract-psl`'s exported pairing functions. _Amended after the dispatch: the planned `FieldSymbol` decoupling was dropped; every candidate the Prisma 7 source builds is a real parsed symbol, and the alternative needed a parser signature change. Keys (`@id`, `@@id`, `@unique`, `@@unique`) were read in this dispatch because one-to-one detection and junction column types need them._
- **Gates:** as dispatch 4 plus `pnpm --filter @internal/sql-contract-psl test`.

### Dispatch 7: error catalogue, edge cases, multi-file, and the enum verify fix

- **Outcome:** Every code in the spec's error catalogue and every row of its edge-case table has a fixture; a directory input reads every `.prisma` file; the provider check runs once over the merged document; `db verify` normalises schema-qualified native enum types (Prisma 8 defect found by dispatch 6, fixed here with a regression test).
- **Builds on:** dispatch 6.
- **Hands to:** the fixture corpus slice 3 round-trips.
- **Gates:** as dispatch 4.

### Dispatch 8: end-to-end proof

- **Outcome:** An integration test applies the `supported/` fixture's SQL (dispatch 1, round 2: the reference schema minus every hard-error construct) to `withDevDatabase`, configures a fixture app with `prisma7Schema`, and runs `contract emit`, `db sign`, and `db verify` through `runOnEngine` with zero findings.
- **Builds on:** dispatch 7.
- **Hands to:** the slice's definition-of-done evidence.
- **Focus:** `test/integration/test/cli-journeys/` following `infer-roundtrip-fidelity.e2e.test.ts`; `journey-test-helpers.ts` gets `runContract...` helpers only if missing.
- **Gates:** `pnpm test:integration` for the new file; the test fails if the interpreter drops any rule (F13).

### Dispatch 9: docs and closing gates

- **Outcome:** `packages/3-extensions/postgres` config reference documents `prisma7Schema`; the package README has its Responsibilities section; repo-wide gates are green.
- **Builds on:** dispatch 8.
- **Hands to:** slice DoD.
- **Gates:** `pnpm build`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm test:packages`, `pnpm fixtures:check`; grep gate for `projects/` references outside `projects/`.

## Handoff completeness

Dispatches 1 and 2 pin items 1, 2, 3, 4, 6. Dispatch 3 gives the grammar. Dispatches 4 to 7 cover every rule row and error code. Dispatch 8 is the end-to-end proof. Dispatch 9 the docs and gates. Together they reach every slice DoD item.
