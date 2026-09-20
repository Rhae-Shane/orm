# Project spec — Postgres SQL functions as schema objects

**Linear:** not yet created. **Issue draft:** [`github-issue.md`](github-issue.md). **Branch:** contribution branch cut from `main`. **Shape:** project, four slices (diagnostics first, then entity MVP).

## Purpose

Raw SQL column defaults can call user-defined Postgres functions (`nanoid(16)`, app-specific helpers, etc.). Today migrate emits only `DEFAULT (<expression>)`. If the function is not already in the catalog, apply fails. Users hand-edit migrations with `CREATE FUNCTION`.

This project makes **app-owned Postgres functions first-class contract entities** so migrate creates and drops them, and adds **diagnostics** so authors do not confuse client generators (`@default(nanoid(16))`) with DB calls (`` @default(sql`nanoid(16)`) ``).

## Background

- Storage defaults of kind `{ kind: 'function', expression }` are rendered as `DEFAULT (<expression>)` after `checkSqlDefaultBody` ([`default-sql-body.ts`](../../packages/2-sql/1-core/contract/src/default-sql-body.ts)). No catalog check.
- Client generators (`nanoid`, `uuid`, `cuid`, `ulid`) lower to `execution.mutations.defaults` and never emit a column default ([`@internal/ids`](../../packages/1-framework/2-authoring/ids/README.md)).
- Pack-contributed entity kinds (ADR 225) already support `role`, `rls`, `policy`, `native_enum`. Docs name custom functions as a future kind ([Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)).
- Opaque SQL bodies + wire naming: checks (ADR 244) and RLS predicates. Functions store an opaque create-body string the same way — the planner does not parse SQL ASTs.
- `remove-dbgenerated` D6: database functions stay raw SQL defaults; do not dress them as Prisma named defaults beside client `nanoid()`.

## Goals

1. Diagnose raw SQL defaults whose expression looks like a client generator call, with a fix hint pointing at `@default(nanoid(...))` / `field.generated(nanoid())` or at declaring a DB function.
2. Author a Postgres `function` entity (TS + PSL) with an opaque SQL body.
3. Migrate plans `CREATE FUNCTION` before tables/columns (`dep` bucket) and `DROP FUNCTION` with type drops (`dropType` bucket).
4. Column defaults keep calling the function via raw SQL (`` sql`nanoid(16)` `` / `dbgenerated`); no typed function-ref in defaults for MVP.

## Non-goals

- Shipping a built-in Prisma `nanoid` PL/pgSQL body as a magic default.
- Auto-inventing `CREATE FUNCTION` because a default mentions a name.
- Introspection / `contract infer` of live functions (deferred).
- `ALTER FUNCTION` / `CREATE OR REPLACE` / body replace as a structured op (deferred; body or signature drift is a planner conflict — drop and recreate).
- Views, triggers, or procedures.
- SQLite or other targets.
- Extension-owned large function dumps (ADR 212 contract spaces) — app contract only for MVP.
- Overloaded functions (same name, different argument types).
- Fine-grained dependency graphs from function bodies to types, extensions, tables, or other functions.

## Decisions

### D1. Postgres-only entity kind `function`

Discriminator / entries key `'function'`. Contract IR node kind `'postgres-function'`. Registered on the Postgres pack via `AuthoringContributions.entityTypes`, same recipe as `native_enum`.

### D2. Opaque body, author owns correctness

The entity stores:

- `functionName` — Postgres function name (unqualified; lives in the entity’s namespace/schema)
- `signature` — argument list as opaque text for `CREATE FUNCTION name(signature)`, e.g. `size int DEFAULT 16`
- `returns` — return type text, e.g. `text`
- `body` — function body text (the part inside `AS $$ … $$` or `AS '…'`), opaque
- optional `language` — default `plpgsql`
- optional `volatility` — default `STABLE` for MVP documentation; rendered into DDL

The planner renders a deterministic `CREATE FUNCTION` / `DROP FUNCTION` from these fields. It does **not** validate that `body` or `signature` is correct SQL; Postgres reports errors at apply. Treat the entity like structured raw SQL — Prisma stores and replays it.

### D3. Planner never synthesizes functions from defaults

A column default that calls `nanoid(16)` does not create a function entity. Authors must declare the function in `entities` / a PSL `function` block. Diagnostics may hint that path.

### D4. Ordering (MVP scope)

`createFunction` classifies as `dep` (with `createNativeEnumType`). `dropFunction` classifies as `dropType`.

**MVP assumption:** managed functions are simple app-owned helpers whose dependencies (extensions, types, tables, other functions) already exist or do not need fine-grained ordering beyond the `dep` bucket relative to tables/columns. Bucket ordering is enough for the showcased `app_nanoid` → column `DEFAULT` case. Fine-grained `dependsOn` from columns to functions, and from function bodies to other catalog objects, is **out of scope** — do not use this MVP for functions that must be created after another function, table, or extension in the same plan.

### D5. Client-generator lookalike diagnostic (temporary naming friction)

When a storage default expression matches a known client generator call shape (`nanoid`, `nanoid(<n>)`, `uuid`, `uuid(4|7)`, `cuid`, `cuid(2)`, `ulid`, with optional schema qualification stripped), authoring emits a diagnostic that distinguishes client vs DB defaults. Severity: **error** at authoring time for the known bare names (authors almost always meant the client generator). Match the **function identifier** after stripping a single optional schema qualifier; if the name is in the client-generator set, emit `PSL_RAW_DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR` / `CONTRACT.DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR`.

**Not a permanent ban on DB functions named `nanoid`.** MVP docs recommend `app_nanoid` (or client `nanoid()`) so Slice A stays a pure string check. A later slice should allow an explicitly declared function entity named `nanoid` to coexist with the client generator: `@default(nanoid(16))` stays client-side; `` sql`nanoid(16)` `` with a declared entity becomes a DB call.

### D6. No named Prisma default for DB nanoid

Do not register `nanoid()` as a storage default function. Client `nanoid()` stays execution-only.

### D7. One physical function name per namespace (no overloads)

Schema identity is `function:<functionName>`. Entries re-key by `functionName` and reject collisions. Postgres overloads are unsupported until identity includes a normalized signature.

### D8. Create-only; no in-place replace

Emit `CREATE FUNCTION` (not `CREATE OR REPLACE`). Changing body or signature is a planner conflict: drop the entity and recreate. This matches the unsupported-update policy and avoids implying replace works.

### D9. DROP only for managed / unclaimed ownership

`DROP FUNCTION` applies when a previously managed function disappears from this space's contract and no sibling space owns it. Control grades `external` / `tolerated` / `observed` must not drop undeclared live functions the same way they suppress other extras. Authors mark extension- or shared-catalog functions `external` so Prisma never claims them.

## Acceptance criteria

- AC1. Raw `` @default(sql`nanoid(16)`) `` / `.default(sql\`nanoid(16)\`)` / `dbgenerated("nanoid(16)")` fails authoring with the lookalike diagnostic and a fix hint.
- AC2. Declaring a `function` entity and a column default that calls it produces a migration whose first relevant ops include `CREATE FUNCTION` before `CREATE TABLE` / `ADD COLUMN` with that default.
- AC3. Dropping a **managed** function entity plans `DROP FUNCTION`; `external` / unowned live functions are not dropped.
- AC4. Docs state client vs DB defaults, MVP dependency limits, no-overload identity, create-only semantics, and opaque-body caveats.
- AC5. Two entities with the same `functionName` in one namespace fail loud at schema construction.

## Out of scope for later slices

- Introspection and infer printing of functions
- Referential check that a default names a declared function
- Cross-schema function references
- `CREATE OR REPLACE` / structured alter
- Overloads and signature-normalized identity
- Fine-grained dependency tracking
- Suppressing the client-generator diagnostic when a matching function entity is declared
