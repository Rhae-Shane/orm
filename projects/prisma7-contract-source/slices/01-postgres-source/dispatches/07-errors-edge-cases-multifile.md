# Dispatch 7: error catalogue, edge cases, multi-file, and the enum verify fix

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Close the gaps between what the interpreter does today and what the slice spec's error catalogue, edge-case table, and multi-file rule require, and fix the one Prisma 8 defect that would block the zero-findings proof, such that every code and every edge-case row has a fixture and a namespaced native enum verifies clean.

## Scope

In:

1. **Error catalogue.** Every code listed in the slice spec's Error catalogue (including the ones added since: `PRISMA7_ENUM_NAMESPACE_MISMATCH`, `PRISMA7_JUNCTION_ID_UNSUPPORTED`) has a fixture asserting code, span line, and message. Add any code you find is still missing for a construct the spec marks as an error and add it to the spec's catalogue line in your report (the orchestrator edits the spec).
2. **Edge cases.** Every row of the slice spec's Edge cases table has a fixture: table-name collision (`PRISMA7_TABLE_COLLISION`, both spans), enum in a namespace (positive), `@default(ENUM_MEMBER)` on a native enum column (this one may stay red until dispatch 5; if so, mark it `todo` with the reason and say so), `@db.Timestamptz(n)` with `@updatedAt` (same), self-referential implicit many-to-many (positive; already covered by dispatch 6, cite it), multi-file with the `datasource` in one file, unknown `previewFeatures` ignored.
3. **Multi-file.** A directory input reads every `.prisma` file directly under it, in sorted filename order, into one document; the provider check runs once over the merged document; diagnostics carry the file they came from. A fixture with a `schema/` directory of three files.
4. **Verify normalisation of schema-qualified enum types.** Dispatch 6 found `db verify` reports `expected audit.AuditAction` versus introspected `audit."AuditAction"` for a native enum in a non-public schema. Find where the introspected native type string is produced (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`) and where the expected side is produced (the codec's `nativeType` for `pg.enum` in `packages/3-targets/3-targets/postgres/src/core/authoring.ts:284-398`), decide which side is canonical by looking at how the same comparison already works for `public` enums and for quoted identifiers elsewhere, and fix the one that is wrong. Regression test in the Postgres target or adapter package that fails before the fix: a namespaced native enum verifies with zero findings. This is a Prisma 8 defect, not a Prisma 7 rule; commit it separately with a message that says so.

Out: defaults, `@updatedAt`, `@@index` (dispatch 5). Mongo. The printer.

## Completed when

- [ ] `pnpm --filter @internal/sql-contract-prisma7 test`, `typecheck`, `lint`, `build` green; the case-name test lists the new cases.
- [ ] The verify regression test is red at its parent commit and green after (state the commands and the failing assertion text).
- [ ] `pnpm --filter integration-tests test prisma7-source` green, and the `audit.audit_log/column:action` path no longer appears in the relations test's filtered-out list (update that list).
- [ ] `pnpm lint:deps`, root typecheck green.

## Halt conditions

- The enum normalisation defect is on the introspection side and fixing it changes what `contract infer` prints for existing users' namespaced enums. Report the blast radius (which tests change) before committing.
- Multi-file needs the parser to carry a file id through spans in a way it cannot today. Report; a per-file `sourceId` in the diagnostic is enough for this dispatch.

## References

- Slice spec Error catalogue and Edge cases; `verification-results.md`; `test/integration/test/prisma7-source/relations.integration.test.ts` (filtered paths).
- `packages/2-sql/9-family/src/core/diff/schema-verify.ts`, `packages/2-sql/1-core/schema-ir/src/ir/sql-column-ir.ts:169-184` (comparison by `resolvedNativeType`), `packages/3-targets/3-targets/postgres/src/core/schema-ir/` (native enum node).
- Failure modes F3, F13, F14, F24, F25 (do not accept "pre-existing" without running on pristine base), F28; F5. Grep gates § Cross-cutting anti-patterns.

## Heartbeat and return shape

As dispatch 1.
