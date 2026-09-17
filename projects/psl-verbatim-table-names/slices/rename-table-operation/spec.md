# Slice spec — Rename-table migration operation

**Project:** `projects/psl-verbatim-table-names/` · **Slice 2** · **Branch:** `psl-verbatim-rename-table` (from `main`)

## At a glance

Today a model whose table name changes plans as `DropTable` plus `CreateTable`, and the rows are gone. After this slice:

```bash
prisma migration new --name rename-user-profile --rename-table userProfile=UserProfile
```

plans one `renameTable` operation followed by whatever else the diff needs, `migrate` runs `ALTER TABLE "userProfile" RENAME TO "UserProfile"`, and the rows survive. The `MIGRATION.TABLE_NAME_CASE_CHANGED` guard's second remedy points at this flag instead of a by-hand `ALTER TABLE`.

## Chosen design

**Intent comes from the CLI, never from inference.** Tables have no content identity the way indexes and checks do (ADR 243), so the planner cannot tell a rename from a drop and a create. The operator states it: `--rename-table <from>=<to>`, repeatable, on `migration new` and on `migration plan` (so a plan can be previewed with the same flags). Either side may be schema-qualified, `auth.userProfile=UserProfile`; an unqualified name means the target's default namespace. Nothing is added to the schema; there is no attribute and no prompt.

**Rename intents are applied to the previous schema before the diff runs.** Rather than pairing issues after the fact, the planner takes the previous state (the prior contract's schema IR, or the introspected live schema) and renames the stated tables in it, then runs the ordinary diff against the next contract, then prepends one `RenameTableCall` per intent to the operations. The differ therefore sees the table under its new name and plans any column, index or constraint changes on it normally, and the case-change guard never sees a drop and create pair for it. Existing index and check rename pairing continues to work on the renamed table, since it pairs by wire-name hash.

**An intent that does not match is a planning failure**, reported through the planner's existing failure result as a conflict: `from` must exist in the previous state, `to` must not, and `to` must exist in the next contract. Silent acceptance of a stale flag would hide a mistake.

**The operation.** `renameTable` in the Postgres and SQLite operation sets, following the `renameCheckConstraint` precedent (PR #29894) end to end: op builder with precheck (`from` exists, `to` absent), execute (`ALTER TABLE ... RENAME TO ...`, schema-qualified on Postgres), postcheck; `RenameTableCall` in the op-factory call union with `renderTypeScript` and import requirements so a hand-written migration can call it; the migration facade method; the public op-factory export. Operation class `widening`, idempotency class per ADR 038 (effect-idempotent with equivalence check: pre-state compatible if `from` or `to` already holds the table). Under an `additive`-only policy the op is refused the same way other `widening` ops are, not degraded to drop and create.

**Guard remedy.** `table-name-case-guard.ts` second way out becomes: `prisma migration new --rename-table "<from>=<to>"` (Postgres and SQLite), keeping the by-hand `ALTER TABLE` sentence only for Mongo. The error reference entry and the upgrade fragments under `upgrade-instructions/pending/psl-verbatim-table-names/` are updated to match.

## Scope

**In:** op builder, call, facade, export, TypeScript rendering for Postgres and SQLite; the pre-diff rename application and the unmatched-intent conflict in the shared SQL family planner code, wired in both target planners; CLI flag parsing and threading for `migration new` and `migration plan`; guard remedy text; error reference; fragment text; tests below.

**Out:** `db update` and `db init` (no flag; the guard still protects them); Mongo; any rename inference; renaming columns; a schema attribute.

## Tests, all red before their change

- Op level, both targets: `renameTable` renders the expected SQL; precheck fails when `from` is missing or `to` exists; `renderTypeScript` round-trips through the migration file parser.
- Planner, both targets: with one intent and otherwise identical tables, the plan is exactly one rename op; with an intent and an added column, the plan is the rename op followed by the add-column op on the new name; an intent whose `from` is absent, or whose `to` already exists, yields a failure conflict naming it; the case-change guard does not fire when the pair is covered by an intent and still fires when it is not; an `additive`-only policy refuses the rename as it refuses other widening ops.
- CLI: `--rename-table` parses repeated and schema-qualified values, rejects a malformed value with a clear error, and reaches the planner options on both commands.
- End to end, Postgres (PGlite) and SQLite, under `test/integration/test/cli-journeys/`: create a table with rows under the old name, change the model's table name, run `migration new --rename-table` then `migrate`, and prove the rows are present under the new name and `db verify --schema-only` is clean.
- Guard text: the existing guard tests pin the new remedy string.

## Done conditions

- Every test above is green; `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts` (delta 0), `pnpm fixtures:check`, `pnpm check:error-reference` pass on the final tree.
- `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD` passes; if it demands a fragment for the app audience (the flag is additive, so probably not), write a truthful one.
- The project DoD line "a model rename in PSL plans as a single rename-table operation on Postgres and SQLite, and the rows survive" is met by the end-to-end test.

## Dispatch plan

1. Red tests: op-level, planner, CLI parsing, and the two journey tests, committed alone with their red logs.
2. The operation and its wiring in both targets, plus TypeScript rendering; op-level tests green.
3. Pre-diff rename application, unmatched-intent conflict, guard interaction, CLI flag threading; planner and CLI tests green.
4. Journeys green, guard remedy and docs and fragments updated, full gate, push (`git push -u bot psl-verbatim-rename-table`). The orchestrator opens the PR.
