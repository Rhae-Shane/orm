# Design notes — prisma7-contract-source

## Principles

- Prisma 7 stays the source of truth for the database until cutover. Prisma 8 adopts the database read-only during the transition.
- A construct is either expressible in the contract or a hard error. No warnings, no silent behaviour changes.
- The Prisma 7 dialect is frozen. Nothing is added to it.
- Fidelity is defined by what `db verify` compares, not by what the PSL can spell.

## The model

A contract source is a `ContractConfig` whose `source.load` returns a family contract or diagnostics. The emit path calls it without caring about format. The Prisma 7 source parses `schema.prisma` with the Prisma 8 syntax parser, which already reads the Prisma 7 grammar almost completely, and interprets it with Prisma 7's rules straight into the family contract. The converter reuses the loaded contract and prints it as Prisma 8 PSL through a new contract-to-PSL printer.

## Alternatives considered

- **One-shot converter that prints Prisma 8 PSL, using Prisma 7's parser.** This was the original spec. Rejected as the primary shape because the converted file drifts after every Prisma 7 migration, because every Prisma 8 PSL spelling limit becomes a lossy rule, and because `@prisma/prisma7` exposes no parser. The converter survives as the cutover step on top of the interpreter.
- **Prisma 7's WebAssembly parser via `@prisma/get-dmmf`.** Rejected. Its DMMF output deletes `@ignore` fields and `@@ignore` models, lists views as ordinary models, and may omit implicit referential actions. It is also a 3 MB synchronous CommonJS load on the emit path.
- **Port Prisma 7's parser to TypeScript.** Unnecessary. The spike under `spike/` shows the Prisma 8 parser handles the grammar with two small additions (attributes on enum members, field lines in `view` blocks).
- **`contract infer` plus hand fixes.** The status quo. Loses relation field names, ORM-side defaults, `@updatedAt`, and needs re-doing after every migration.
- **Filling the capability gaps in this project** (views, Mongo defaults, Mongo scalar types, opaque Postgres columns). Rejected by the operator: hard error now, fill later. Mongo defaults alone is a runtime change touching the contract validator, the generator registry, and the ORM.

## Decisions settled in shaping

- `cuid()` maps to the cuid2 generator. Prisma 7's `cuid()` is cuid v1, which Prisma 8 does not ship; the column type is identical and ids are opaque.
- `@updatedAt` becomes on-create and on-update generators with column `timestamp(3)`, allowed on optional fields and alongside `@default(now())`, because the contract permits both and only the PSL spelling forbids them.
- Implicit many-to-many relations become the junction model Prisma 7 creates, with a `(A, B)` primary key. Databases last migrated on Prisma 5 or earlier have a unique index instead (Prisma 6.0.0 made the change) and must migrate on Prisma 7 first.
- Constraint names are set only where `db verify` compares them: indexes and check constraints.
- `defineConfig` accepts a `ContractConfig` for `contract`, and `prisma7Schema(path)` returns one. Detection by file content was rejected as magic.

## Open questions

**Optional `@updatedAt` and `@default(now()) @updatedAt` (raised 2026-09-13 by dispatch 2, blocks dispatch 5).** The contract accepts execution generators on a nullable column and alongside a storage default, and `db verify` is satisfied. But Prisma 8 PSL cannot spell either: a preset field may not be optional, and a preset may not combine with `@default`. So a contract built from `updatedAt DateTime? @updatedAt` or `updatedAt DateTime @default(now()) @updatedAt` cannot be printed by the converter, which breaks cross-cutting requirement 5 (round-trip hash equality). Both are common Prisma 7 patterns. Options: (a) hard error in the Prisma 7 source, per the "hard error now, fill later" rule; (b) relax the Prisma 8 PSL interpreter so a preset with no storage default may carry `@default` and a preset may be optional, then both forms round-trip. **Decided 2026-09-13 by the orchestrator, applying the operator's standing rule, with no operator reply: (a).** The orchestrator's recommendation was (b) because `@default(now()) @updatedAt` is in most Prisma 7 schemas. Switching to (b) later is a change to two checks in `psl-field-resolution.ts` plus removing two error codes; the fixtures for both forms exist either way.

## References

- `spec.md`, `plan.md`, `slices/*/spec.md`.
- Parser spike: `spike/schema.prisma`, `spike/tree.txt`, `spike/dump-tree.ts`.
- `projects/prisma-8-rc1/parallel-install.md` for the transition story this project serves.
