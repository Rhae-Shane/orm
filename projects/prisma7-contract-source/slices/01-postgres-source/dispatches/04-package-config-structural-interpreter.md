# Dispatch 4: package, config, and the structural interpreter

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session; if the interpreter half is not finished when the session budget is half spent, commit the package and config half and report, so the interpreter continues as a follow-on round.

## Task

Create the Prisma 7 contract source package for the SQL family and make it interpret the structural half of the rule table, such that `defineConfig({ contract: prisma7Schema('schema.prisma') })` loads a Prisma 7 file into a validated `SqlContract` whose models, columns, types, namespaces, and enums match what Prisma 7 created, and every unsupported construct in this half is a diagnostic with a span.

The property this preserves: the framework layer learns nothing family-specific; the family authoring layer owns the Prisma 7 rules; the CLI is untouched.

## Scope

In:

- New package `packages/2-sql/2-authoring/contract-prisma7`, name `@internal/sql-contract-prisma7`, laid out like `packages/1-framework/3-tooling/vite-plugin-contract-emit` (package.json fields, tsdown config, tsconfigs, vitest config, biome.jsonc, coverage.config.json, README with a `## Responsibilities` section, `src/exports/` one file per entry point, no barrels). Version matches the repo. Add its glob to `architecture.config.json` as domain `sql`, layer `authoring`, plane `migration`, next to `contract-psl`.
- `prisma7Schema(path: string, options?)` returning a `ContractConfig` in the same shape `prismaContract` returns (`packages/2-sql/2-authoring/contract-psl/src/provider.ts:65`): `source.inputs = [path]`, `format: 'prisma7'`, and a `source.load(context)` that reads the resolved input, parses each `.prisma` file with `parse()` from `@internal/psl-parser`, and runs the interpreter. A directory input reads every `.prisma` file under it (non-recursive is fine for this dispatch; say so in the README). Look at how `contract-emit.ts:225-240` consumes `load` results and return exactly `ok(contract)` or `notOk({ summary, diagnostics })`.
- `defineConfig` in `packages/3-extensions/postgres/src/config/define-config.ts` accepts `contract: string | ContractConfig`; a `ContractConfig` value is used as-is and the output path derives from its first input. Export `prisma7Schema` from `@prisma/orm-postgres/config`.
- The interpreter, covering these slice-spec rows only: Blocks (`datasource` provider check, `relationMode`, `generator` ignored, `model`, `enum` to native enum, `view` error, `@@schema`, `@@ignore`), Naming, Field types (scalars, `@db.*` from the fixture-derived table in `verification-results.md` item 6, nullable list columns, `Unsupported`, unmapped native types), `@ignore` on fields. Build the contract the way `contract-psl`'s interpreter does, through the same lowering helpers where they are reusable; do not construct contract JSON by hand where a builder exists. Every produced contract must pass `validateContract` from `@internal/sql-contract`.
- Diagnostics: `PslDiagnostic` shape, codes `PRISMA7_PROVIDER_MISMATCH`, `PRISMA7_RELATION_MODE_UNSUPPORTED`, `PRISMA7_VIEW_UNSUPPORTED`, `PRISMA7_UNSUPPORTED_TYPE`, `PRISMA7_NATIVE_TYPE_UNSUPPORTED`, `PRISMA7_UNKNOWN_ATTRIBUTE` (any attribute this dispatch does not yet handle, so defaults, keys, and relations fail loudly until dispatches 5 and 6 land; note that in the fixture expectations).
- Fixtures under the package's `test/fixtures/<case>/schema.prisma` with either `expected-contract.json` (validated, snapshot-style) or `expected-diagnostics.json`, one case per rule row above, plus a test that runs every fixture. The `supported/` fixture from `test/integration/test/fixtures/prisma7-source/` is not expected to pass yet (it has defaults and relations); do not add it here.

Out:

- Defaults, keys, uniques, indexes, relations (dispatches 5 and 6). Mongo. The CLI. The printer. Any change to `contract-psl` beyond importing exported helpers (if a helper you need is not exported, export it from `contract-psl`'s `exports/` and say so; do not copy it).

## Completed when

- [ ] `pnpm --filter @internal/sql-contract-prisma7 test`, `typecheck` (including test tsconfig), `lint` green; `pnpm --filter @internal/sql-contract-prisma7 build` then `pnpm --filter @prisma/orm-postgres typecheck` green; `pnpm lint:deps` green; `pnpm lint:docs` green for the new README.
- [ ] A type-level test shows `defineConfig({ contract: prisma7Schema('x.prisma') })` compiles and `defineConfig({ contract: 'x.prisma' })` still compiles.
- [ ] Every fixture case passes, each error fixture asserts the code and the span line, and one fixture per Field-types row exists (a grep of `test/fixtures/*/schema.prisma` shows every `@db.*` spelling from item 6 that is accepted, and one case per rejected spelling).

## Halt conditions

- The contract IR cannot express something this half needs (for example a native enum placed in a non-public namespace, which the `supported/` SQL requires: `CREATE TYPE "audit"."AuditAction"`). Stop and report with the IR file and line.
- `ContractConfig` cannot carry a new `format` value without changing the framework type in a way that breaks the language server or `contract format`. Report the type location and the smallest change; do not make it.
- `defineConfig`'s `contract: string` is consumed elsewhere in a way that makes `string | ContractConfig` a breaking change for existing users. Report.

## References

- `packages/2-sql/2-authoring/contract-psl/src/provider.ts`, `interpreter.ts`, `psl-field-resolution.ts` (naming at 725-748, type resolution at 496-537), `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:163-321` (accepted type names), `packages/3-targets/3-targets/postgres/src/core/authoring.ts:284-398` (native enums).
- `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` item 6 and `test/integration/test/fixtures/prisma7-source/reference/schema.prisma` for the constructs.
- Rules: `.agents/rules/no-barrel-files.mdc`, `no-inline-imports.mdc`, `no-bare-casts.mdc`, `arktype-usage.mdc`, `use-pathe-for-paths.mdc`, `required-key-undefined-fields.mdc`, `interface-factory-pattern.mdc`, `no-contract-data-patching-in-tests.mdc`, `test-file-organization.mdc`.
- Failure modes F3, F11 (spec-pinned module placement), F13, F14, F16, F24, F28; F5 (no destructive git). Grep gates from `drive/calibration/grep-library.md` § Cross-cutting anti-patterns.

## Heartbeat and return shape

As dispatch 1. In the report, list every `contract-psl` helper you reused and every one you had to export.
