# Dispatch 10: manual QA fixes

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md` (added after the QA run)
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Resolve every finding in `projects/prisma7-contract-source/manual-qa-reports/2026-09-13-qa-runner.md`, such that a Prisma 7 user following only the README gets a working config on the first try and sees the exact diagnostic, line, and fix in the terminal when something is rejected.

## Scope

In, one commit per numbered item:

1. **F-1, README config.** The README's `prisma.config.ts` must be the shape the CLI accepts: `defineConfig` from `@prisma/cli-engine` wrapping the ORM config under `orm`, with `prisma7Schema` from `@prisma/orm-postgres/config`, exactly as `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma.config.prisma7.ts` does but with the published package name. Look at how `packages/1-framework/3-tooling/cli/README.md` and the `init` templates present the same file and match them. Also cover F-6 (a `package.json` that depends on `@prisma/orm-postgres` is required for `contract.d.ts` to import published names) and F-7 (where `db.connection` comes from; that Prisma 7 schemas keep their datasource without `url`, since Prisma 7 moved it to config; that output is JSON when stdout is not a terminal, if that is the CLI's documented behaviour, check `docs/CLI Style Guide.md`).
2. **F-2 and F-3, diagnostics in human output.** When `contract emit` fails with `CONTRACT.SOURCE_LOAD_FAILED`, the human presentation must print every diagnostic (code, file, line, message) and the next-action line must be user-facing, not "return ok(Contract)". First check on `origin/main` whether the PSL source has the same gap (F25); if it does, this is a Prisma 8 defect and the fix is in the CLI's presentation of source-load failures for every source (`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts:99-130` and the `orm/contract/emit.ts` presentations), with a test that runs the command in-process and asserts the human output contains the code and line. If only the Prisma 7 source lacks it, fix the source's `notOk` payload instead. Say which.
3. **F-4 and F-5, default output path.** `prisma7Schema(path)` defaults its output to `contract.json` (and `contract.d.ts`) beside the schema file, or beside the schema directory when a directory is given (`prisma/schema/` writes `prisma/contract.json`), never inside the directory and never named after the schema file. `options.output` overrides. Update the provider test and the README's sentence about output, and document `output`.
4. **Re-run QA steps 1, 4, 5, and 6** from `manual-qa.md` yourself in `wip/qa-prisma7/` (the scratch app exists) and append a "Re-run after dispatch 10" section to the report with commands and outputs.

Out: anything not in the report.

## Completed when

- [ ] Each finding F-1 to F-7 has a line in the report's re-run section saying fixed, with the evidence, or documented, with the README anchor.
- [ ] A test asserts the human output of a failing `contract emit` contains the diagnostic code, file, and line.
- [ ] Package tests, typecheck, lint, build for every touched package; `pnpm --filter integration-tests test prisma7-source cli-journeys/prisma7-source` green; `pnpm lint:docs`; root typecheck.

## Halt conditions

- The human-output fix requires changing the CLI engine's error envelope shape (owned by the external `@prisma/cli-engine` package). Report the constraint and do the best presentation the envelope allows.

## References

- The QA report; `docs/CLI Style Guide.md`; `packages/1-framework/3-tooling/cli/src/orm/contract/{emit,infer}.ts` presentations; `.agents/rules/cli-error-handling.mdc`.
- Failure modes F12, F13, F14, F23, F25; F5.

## Heartbeat and return shape

As dispatch 1.
