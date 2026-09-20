# Postgres SQL functions

Shaping and implementation for first-class Postgres `function` entities so migrate can `CREATE`/`DROP` user-defined functions (the `nanoid` / raw SQL default footgun).

| Artifact | Path |
|---|---|
| Spec | [`spec.md`](spec.md) |
| Plan | [`plan.md`](plan.md) |
| GitHub issue draft | [`github-issue.md`](github-issue.md) |

## File the issue

This environment does not have the official GitHub CLI. To open the issue:

1. Install [GitHub CLI](https://cli.github.com/) (not the npm `gh` package).
2. From the repo root:

```bash
gh issue create --title "Custom Postgres functions as schema objects (DB-side nanoid / raw SQL defaults break migrate)" --body-file projects/postgres-sql-functions/github-issue.md
```

Or paste [`github-issue.md`](github-issue.md) into https://github.com/prisma/orm/issues/new.

## What landed in-tree (MVP)

- **Diagnostics:** raw `` sql`nanoid(...)` `` / `dbgenerated("nanoid(...)")` refused when the expression looks like a client generator (`PSL_RAW_DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR` / `CONTRACT.DEFAULT_LOOKS_LIKE_CLIENT_GENERATOR`).
- **Entity:** `PostgresFunction` + PSL `function` block + TS `pgFunction(...)` on the entities list.
- **Migrations:** `createFunction` / `dropFunction` in the `dep` / `dropType` buckets so CREATE FUNCTION runs before CREATE TABLE.

Prefer client `@default(nanoid(16))` / `field.generated(nanoid())` when the app always inserts through Prisma. For a DB-side helper, name it something other than a Prisma generator (e.g. `app_nanoid`) and declare it with `pgFunction` / `function`.
