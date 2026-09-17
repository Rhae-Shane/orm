---
changes:
  - id: default-sql-replaces-default-sql-method
    summary: |
      `.defaultSql('...')` on the TypeScript contract builder is deprecated and is removed in 8.0.0.
      Rewrite each call to `.default(...)` with a named helper or the `sql` template tag.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.defaultSql\('
  - id: psl-raw-sql-default-is-a-tagged-literal
    summary: |
      In PSL, a raw SQL column default is written as a tagged literal, ``@default(sql`...`)`` or
      `@default(sql"...")`. `@default(dbgenerated("..."))` still works in this release; the new
      forms are the ones to write.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
---

## `default-sql-replaces-default-sql-method`

Rewrite every `.defaultSql('<expression>')` call by its expression:

| Call | Replacement | Import |
| --- | --- | --- |
| `.defaultSql('now()')` | `.default(now())` | `now` from the contract builder |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` | `autoincrement` from the contract builder |
| `.defaultSql('<anything else>')` | `` .default(sql`<anything else>`) `` | `sql` from the contract builder |

There is no named helper for other database functions: `.defaultSql('gen_random_uuid()')` becomes `` .default(sql`gen_random_uuid()`) ``.

Import the helpers from the module the code already imports `defineContract`, `field`, and `model` from (`@prisma/orm-postgres/contract-builder`, `@prisma/orm-sqlite/contract-builder`, or the internal `@internal/sql-contract-ts/contract-builder`). `sql` takes no interpolation: write the SQL as one literal. Every form lowers to the same `{ kind: 'function', expression }` default, so re-run `prisma contract emit` and confirm `contract.json` is unchanged.

## `psl-raw-sql-default-is-a-tagged-literal`

Rewrite every `@default(dbgenerated("<expression>"))` by its expression:

| Default | Replacement |
| --- | --- |
| `@default(dbgenerated("now()"))` | `@default(now())` |
| `@default(dbgenerated("autoincrement()"))` | `@default(autoincrement())` |
| `@default(dbgenerated("<anything else>"))` | `` @default(sql`<anything else>`) ``, or `@default(sql"<anything else>")` when the expression contains backticks |

The first two rows are required, not a matter of style: `` sql`now()` `` and `` sql`autoincrement()` `` are refused with `PSL_INVALID_DEFAULT_SQL`, because Prisma reads those two expressions as its own default functions. Every other expression, including `NOW()` and `gen_random_uuid()`, is used as written, so `@default(dbgenerated("gen_random_uuid()"))` becomes `` @default(sql`gen_random_uuid()`) ``. `prisma contract infer` still prints `dbgenerated(...)` for raw expressions in this release. `dbgenerated("...")` still emits the same contract in this release, so this rewrite can happen at any time before it is removed.
