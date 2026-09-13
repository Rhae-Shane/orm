# Dispatch 1: Prisma 7 ground truth

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Produce a committed fixture that records what Prisma 7.10.0 actually creates in Postgres for a schema that exercises every construct the slice spec's rule table covers, such that every later rule is written against Prisma 7's real output rather than memory.

## Scope

In:

- A Prisma 7 schema at `test/integration/test/fixtures/prisma7-source/reference/schema.prisma` containing: every scalar (`String`, `Boolean`, `Int`, `BigInt`, `Float`, `Decimal`, `DateTime`, `Json`, `Bytes`) with and without `?` and as `[]`; every Postgres native type attribute Prisma 7 documents for those scalars (`@db.Text`, `@db.VarChar(n)`, `@db.Char(n)`, `@db.Uuid`, `@db.Inet`, `@db.Citext`, `@db.Bit(n)`, `@db.VarBit(n)`, `@db.Xml`, `@db.Boolean`, `@db.Integer`, `@db.SmallInt`, `@db.Oid`, `@db.BigInt`, `@db.Real`, `@db.DoublePrecision`, `@db.Decimal(p,s)`, `@db.Money`, `@db.Timestamp(n)`, `@db.Timestamptz(n)`, `@db.Date`, `@db.Time(n)`, `@db.Timetz(n)`, `@db.Json`, `@db.JsonB`, `@db.ByteA`); an enum with `@@map` and a member `@map`; a model with `@updatedAt`, `@updatedAt` on an optional field, and `@default(now()) @updatedAt`; every default function (`autoincrement()`, `now()`, `dbgenerated("...")`, `uuid()`, `uuid(7)`, `cuid()`, `cuid(2)`, `ulid()`, `nanoid()`, literals, enum member); `@id`, `@@id`, `@unique`, `@@unique`, `@@index` with and without `map:`, `@@index(type: Hash)`; explicit one-to-many and one-to-one relations with actions omitted, on required and optional scalars; an implicit many-to-many and a named implicit many-to-many; a self-referential implicit many-to-many; `previewFeatures = ["multiSchema"]` with two schemas and `@@schema` on every model and enum; an `Unsupported("tsvector")` field; a `view`; `@ignore` and `@@ignore`.
- The SQL Prisma 7.10.0 generates for it at `reference/migration.sql`, produced by `pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema-datamodel schema.prisma --script` run from a scratch directory under `wip/prisma7-reference/` (gitignored, outside the pnpm workspace globs). If `migrate diff` needs a datasource URL to run, use any syntactically valid Postgres URL; the diff does not connect.
- A `reference/README.md` stating the Prisma version, the exact command, and the date.
- A short research note at `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` with two sections filled: **Item 6** (the native type table as a markdown table derived from the SQL: Prisma 7 spelling → Postgres column type) and **Item 4** (which Prisma version switched implicit junction tables from `_AB_unique` unique index to an `_AB_pkey` primary key, with the changelog URL; and what 7.10.0 emits, quoted from the SQL). Leave headings for items 1, 2, 3 empty for dispatch 2.

Out:

- Any production code. Any dependency change. Anything under `packages/`.
- Applying the SQL to a database.

## Completed when

- [ ] `reference/schema.prisma`, `reference/migration.sql`, `reference/README.md` are committed, and the SQL contains `CREATE TABLE "_` for the implicit junctions and a `CREATE TYPE` for the enum.
- [ ] `verification-results.md` has items 6 and 4 filled with data quoted from the SQL and a changelog citation.
- [ ] `git diff --stat main -- pnpm-lock.yaml` is empty and `wip/` contains the scratch directory only.

## Halt conditions

- `pnpm dlx` cannot fetch `prisma@7.10.0` (network, registry policy, or the 24-hour release cooldown). Report the exact error; do not try `npm`, `npx`, or a workspace install.
- Prisma 7 rejects any construct in the schema. Remove the smallest offending piece, note it in the README, and continue.

## References

- Slice spec: `projects/prisma7-contract-source/slices/01-postgres-source/spec.md`.
- Repo rules: `CLAUDE.md` (pnpm only, never npx, Node from the shell), `.agents/rules/git-staging.mdc`.
- Failure modes: F3, F14 in `drive/calibration/failure-modes.md`. Destructive git operations are forbidden without orchestrator approval (F5).

## Heartbeat

Append a line to `wip/heartbeats/implementer.txt` every few minutes: ISO timestamp, phase, one sentence.

## Return shape

Report: what was produced (paths), the three checklist items with evidence, the halt conditions hit if any, and anything in Prisma 7's output that contradicts the slice spec.
