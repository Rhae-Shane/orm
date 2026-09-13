# Prisma 7 contract source and converter

> Shaped 2026-09-13. Every claim below was checked against the code on `main` at f2e3590ff2. Rule tables live in the slice specs under `slices/`; this file holds only what is true at the project level.

## Purpose

Prisma 7 users have a `schema.prisma`. Prisma 8 reads a `contract.prisma` in a different dialect. During the side-by-side period Prisma 7 keeps owning the database and its migrations, so the Prisma 7 schema is the source of truth until cutover. Today the only way to get a Prisma 8 contract from an existing database is `contract infer`, which loses relation field names, ORM-side defaults, and `@updatedAt`, and needs hand fixing after every Prisma 7 migration.

This project lets Prisma 8 read the Prisma 7 schema directly as a contract source, so the transition needs no second schema file, and gives users a converter that prints that contract as Prisma 8 PSL for cutover.

## At a glance

During the transition, `prisma.config.ts` points at the existing file:

```ts
import { defineConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default defineConfig({
  contract: prisma7Schema('prisma/schema.prisma'),
});
```

`prisma contract emit` and `prisma db sign` work unchanged. When Prisma 7 migrates, the user runs them again.

At cutover:

```bash
prisma contract convert --output src/prisma/contract.prisma
```

writes the same contract as Prisma 8 PSL. The user switches `contract:` to that file and removes Prisma 7.

## Non-goals

- Filling capability gaps. Views, Mongo defaults and automatic timestamps, Mongo `Json`/`Bytes`/`Decimal`/`BigInt`, opaque Postgres columns (`Unsupported(...)` and native types with no codec), referential-action emulation on Mongo, and `relationMode = "prisma"` are hard errors in this project. See § Deferred gaps.
- Query-code rewriting.
- Migration history and `_prisma_migrations`.
- Prisma 6 schemas that are not valid Prisma 7 schemas.
- Extending the Prisma 7 dialect. It is frozen.
- Teaching `contract format` or the language server to read Prisma 7 files.

## Place in the larger world

- The transition story this serves is `projects/prisma-8-rc1/parallel-install.md`: Prisma 7 owns migrations, Prisma 8 adopts the database read-only with `db sign`, and cutover happens once.
- Contract sources are `ContractConfig` objects whose `source.load` returns a contract or diagnostics; the emit path calls it without caring about format (`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts:227`). The PSL source (`packages/2-sql/2-authoring/contract-psl/src/provider.ts:65`) and the TypeScript source (`packages/2-sql/2-authoring/contract-ts/src/config-types.ts:90`) are the two existing kinds. This project adds a third, one package per family, mirroring `contract-psl`.
- The Prisma 8 syntax parser (`@internal/psl-parser`) already reads the Prisma 7 grammar almost completely. See `spike/` and `design-notes.md`.
- Every existing PSL printer starts from the database schema description, not from a contract. The contract-to-PSL printer is new and exposed as a target-descriptor hook beside `inferPslContract`.

## Cross-cutting requirements

1. **Hard errors, never warnings.** Every Prisma 7 construct is either expressible in the family contract or rejected with a diagnostic that names the construct, points at its span, and states the fix or that the construct is not yet supported. The interpreter never changes behaviour silently. Diagnostics use the existing `PslDiagnostic` shape with codes prefixed `PRISMA7_`.
2. **Fidelity is defined by `db verify`.** The interpreter must produce a contract that `db sign` verifies with zero findings, in lenient mode, against the database Prisma 7 built. `db verify` (`packages/2-sql/9-family/src/core/diff/schema-verify.ts`) compares: column native type string and nullability (never the codec); column defaults structurally; primary key columns but not the name; foreign key `onDelete` and `onUpdate` with `noAction` equal to absent, but not the name; unique constraints by columns, not the name; indexes by name plus uniqueness, type, and columns; check constraints by name; native enums by type name and ordered member list. Consequences: reproduce Prisma 7's default index names, always set both referential actions explicitly, keep enum member order, and leave key, foreign key, and unique names to Prisma 8.
3. **No Prisma 7 packages.** No package in the repo depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`. Parsing uses `@internal/psl-parser`.
4. **Layering.** Family-specific rules live in the family authoring packages (`packages/2-sql/2-authoring/contract-prisma7`, `packages/2-mongo-family/2-authoring/contract-prisma7`). The Prisma 7 source is a `ContractConfig`, and `defineConfig` in both `@prisma/orm-postgres/config` and `@prisma/orm-mongo/config` accepts `contract: string | ContractConfig`. Nothing family-specific enters `packages/1-framework`.
5. **Round trip is a hash equality.** For every fixture, interpreting the Prisma 7 file and interpreting the converted Prisma 8 file produce the same contract hashes, so the signed marker survives cutover.
6. **Multi-file schemas.** A directory path reads every `.prisma` file in it, matching Prisma 7's multi-file layout.

## Transitional-shape constraints

None. Each slice lands a complete, usable surface: slice 1 ships the Postgres source end to end, slice 2 the Mongo source, slice 3 the converter.

## Contract impact

New contract sources only. No change to the contract JSON shape, `contract.d.ts`, or any migration artefact. The Postgres contract produced from a Prisma 7 schema uses only entity kinds and codecs that exist today.

## Adapter impact

Postgres and Mongo. SQLite is not a Prisma 7 side-by-side target in this project.

## ADR pointer

Close-out writes an ADR for the contract-source extension point and the "hard error, no warnings" rule for legacy dialects.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- Every rule row and every `PRISMA7_` error code in the slice specs has a fixture that passes through the real parser and interpreter.
- The Postgres and Mongo end-to-end proofs emit, sign, and verify with zero findings in lenient mode against databases shaped by Prisma 7 migrations.
- For every fixture, `hash(interpret(prisma7)) === hash(interpret(convert(prisma7)))`.
- A schema using any unsupported construct fails emit with one diagnostic per construct and no partial output.
- No package depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`.
- CLI README documents `contract convert` and the config reference documents `prisma7Schema`.

## Plan-time verification items

Each is resolved by a test inside the slice that depends on it, before the dependent rule is written.

1. `autoincrement()` lowering versus Prisma 7's sequence default (slice 1).
2. `now()` default equality against Prisma 7's `CURRENT_TIMESTAMP` (slice 1).
3. Contract validator acceptance of a column default together with execution generators, and of generators on nullable columns (slice 1).
4. The version at which the implicit junction gained a primary key (slice 1). Resolved by dispatch 1: Prisma 6.0.0; 7.10.0 emits `_AToB_AB_pkey`.
5. Whether Mongo verify compares index names (slice 2).
6. The exact Prisma 7 Postgres native type table (slice 1). Resolved by dispatch 1: `test/integration/test/fixtures/prisma7-source/reference/migration.sql`.
7. Whether lenient `db verify` tolerates an extra table, an extra column, and an extra foreign key, which `@ignore` and `@@ignore` rely on because Prisma 7 still creates that schema (slice 1).

## Deferred gaps

Recorded so they are not lost; each becomes its own project when scheduled.

- Views: no schema node, introspection selects `BASE TABLE` only (`control-adapter.ts:702-709`), verify reports a missing table.
- Mongo execution defaults: the Mongo contract validator rejects `execution` (`contract-schema.ts:444-472`); the runtime generator machinery lives only in `packages/2-sql/5-runtime/src/sql-context.ts`; no Mongo timestamp generator; the default's reference shape is SQL-specific.
- Mongo codecs for BSON binary, Decimal128, Int64, embedded documents.
- A `pg/opaque` codec carrying the native type name, which also repairs `contract infer` emitting `Unsupported(...)` that nothing reads back.
- A cuid v1 generator, if mapping `cuid()` to cuid2 turns out to matter.
- Referential-action emulation on Mongo.

## References

- `design-notes.md` for alternatives considered.
- `spike/` for the parser experiment.
- `slices/01-postgres-source/spec.md`, `slices/02-mongo-source/spec.md`, `slices/03-contract-to-psl-and-convert/spec.md`.
