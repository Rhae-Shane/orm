# GitHub issue draft — file on prisma/orm

> **Status:** Ready to file. This environment does not have the official GitHub CLI (`gh` resolves to an unrelated npm package). Paste this into a new issue at https://github.com/prisma/orm/issues/new or run `gh issue create` after installing https://cli.github.com/.

## Title

Custom Postgres functions as schema objects (DB-side `nanoid` / raw SQL defaults break migrate)

## Body

### Problem

When a schema uses a **database** default that calls a user-defined Postgres function that is not built in, migrate emits only the column `DEFAULT` and fails at apply time:

```prisma
model User {
  id String @id @default(dbgenerated("nanoid(16)")) @db.VarChar(16)
}
```

or (Prisma 8 direction):

```prisma
id String @id @default(sql`nanoid(16)`) @db.VarChar(16)
```

Postgres reports something like `function nanoid(integer) does not exist`. Users must hand-edit the migration to add `CREATE OR REPLACE FUNCTION nanoid(...)` before the table/column DDL.

This is easy to confuse with Prisma’s **client-side** generator of the same name:

| Authoring | Plane | Migration |
|---|---|---|
| `@default(nanoid(16))` / `field.generated(nanoid())` | Client generates before insert | No `DEFAULT` |
| `@default(dbgenerated("nanoid(16)"))` / `` @default(sql`nanoid(16)`) `` | DB must already have `nanoid(int)` | `DEFAULT (nanoid(16))` only |

### Why Prisma does not invent the function today

The migration planner renders authored default expressions verbatim after a syntax safety check. It does **not** synthesize `CREATE FUNCTION` from a default expression. That matches the design rule: authoring declares, the planner reconciles — never invent undeclared schema objects (see ADR 244 / check-constraint unification).

Docs already name the long-term recipe: pack-contributed entity kinds for “custom functions, views” beside RLS ([Adapters & Targets](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/5.%20Adapters%20%26%20Targets.md)).

### Proposed directions (need maintainer pick)

1. **Diagnostics / docs** — Warn or error when a raw SQL default expression looks like a known client generator (`nanoid`, `cuid`, `ulid`, `uuid`, …); document client vs DB defaults and the hand `CREATE FUNCTION` workaround.
2. **First-class Postgres `function` entity** — PSL/TS block → contract IR → schema IR → `CREATE`/`DROP FUNCTION` in migrations (create in the `dep` bucket like native enums), with defaults still written as raw SQL that call the declared function. Do **not** invent a named Prisma default that means “DB nanoid” (conflicts with client `nanoid()`; see remove-dbgenerated D6).

Shaping docs for (2) live under `projects/postgres-sql-functions/` on the contribution branch.

### Immediate workaround

Prefer client-side generation when the app always inserts through Prisma:

```ts
id: field.generated(nanoid({ size: 16 })).id()
```

Only use a DB-side `nanoid` when Postgres must generate the value (raw SQL inserts, multi-writer without the client). Until (2) lands, that path still requires a hand-written `CREATE FUNCTION` in the migration.

### Ask

Which scope should the first PR target — (1), (2), or (1) then (2)? Any constraints on opaque function bodies, introspection, or extension-space ownership (ADR 212)?
