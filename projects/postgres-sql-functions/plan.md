# Project plan — Postgres SQL functions

Spec: [`spec.md`](spec.md). Issue draft: [`github-issue.md`](github-issue.md).

## Slices

| Slice | Deliverable | Depends on |
|---|---|---|
| A | Diagnostics + docs (client-generator lookalike in raw SQL defaults) | — |
| B | Contract IR + authoring (TS `pgFunction` + PSL `function` block) | A (docs context) |
| C | Schema IR + CREATE/DROP DDL + planner classification | B |
| D | Integration test: nanoid function + column default orders correctly | C |

Slices B–D form the MVP entity. A can merge alone.

## Slice A — Diagnostics + docs

1. Extend [`default-sql-body.ts`](../../packages/2-sql/1-core/contract/src/default-sql-body.ts) with `clientGeneratorSqlDefaultBody(body)` returning the matched generator name or `undefined`.
2. Wire into PSL sql-tag / dbgenerated lowering and TypeScript `sql` / `defaultSql` paths with diagnostic codes documented in [`error-reference.md`](../../docs/reference/error-reference.md).
3. Short doc note in contract-psl README + ids README linking client vs DB.
4. Unit tests for match / non-match cases (`gen_random_uuid()` must not match).

## Slice B — IR + authoring

1. `PostgresFunction` IR class + arktype schema + `functionEntityKind`.
2. Register in `postgresAuthoringEntityTypes` / PSL block / `composeSqlEntityKinds`.
3. TS helper `pgFunction({ name, signature, returns, body, … })` under `@prisma/postgres` contract surface (mirror `nativeEnum`).
4. Authoring tests.

## Slice C — Migrations

1. `PostgresFunctionSchemaNode` + namespace children + contract→schema projection.
2. `CreateFunctionCall` / `DropFunctionCall` + DDL render + `classifyCall` (`dep` / `dropType`).
3. Planner unit tests.

## Slice D — Happy path

Integration test: contract with `nanoid` function entity + column `` .default(sql`nanoid(16)`) `` plans CREATE FUNCTION before CREATE TABLE.

Note: Slice A’s diagnostic will refuse bare `nanoid(16)` as a raw default. The happy path for DB-side nanoid after A must either (a) use a **different** DB function name (e.g. `app_nanoid(16)`) in the default expression, or (b) allow an authoring escape (declared function entity with matching name suppresses the diagnostic). **Decision for this project:** (b) — if a `function` entity with `functionName === matchedName` exists in the same contract namespace in scope at build time, suppress the lookalike diagnostic. Until entity authoring lands, tests for DB-side defaults use a non-client name (`app_nanoid`) or temporarily test the diagnostic only. Slice D uses `app_nanoid` for the default expression to keep A and D independent, documenting that renaming avoids the client-generator collision.

Amendment: prefer **(a) `app_nanoid`** for Slice D so Slice A stays a pure string check without a contract-wide entity scan. Authors who want DB `nanoid` name the function `nanoid` and use an escape hatch later; MVP docs recommend `app_nanoid` or client `nanoid()`. That collision is temporary — a later slice should suppress the diagnostic when a matching function entity is declared.

Review follow-ups landed on the same branch: create-only (no `OR REPLACE`), name-only identity with explicit overload rejection, function storage coordinates for control-policy DROP gating, and tighter MVP dependency wording in the spec.
