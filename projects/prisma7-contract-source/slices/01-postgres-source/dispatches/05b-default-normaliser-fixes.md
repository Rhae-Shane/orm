# Dispatch 5b: Prisma 8 default-normaliser fixes

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md` (added after dispatch 5)
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Fix the Prisma 8 default normaliser so column defaults Prisma 7 writes are recognised on introspection, such that the full-schema proof in `supported.integration.test.ts` reports zero findings and any Prisma 8 user with those defaults gets the same benefit.

These are Prisma 8 defects, not Prisma 7 rules. Each fix is its own commit with a regression test in the Postgres target package that is red on the parent commit (F25: prove it, quote the failing assertion).

## Scope

In, all in `packages/3-targets/3-targets/postgres/src/core/default-normalizer.ts` unless the real cause is elsewhere:

1. **Schema-qualified enum literal casts.** `'CREATE'::audit."AuditAction"` must normalise to the literal `CREATE` with the enum type recognised, the same way `'CREATE'::"AuditAction"` and `'CREATE'::audit_action` already do. Reuse the per-segment unquoting from dispatch 7 rather than a second parser.
2. **Zoneless timestamp literals.** `'2024-01-01 00:00:00'::timestamp without time zone` must compare equal to the contract's literal for a `timestamp(3)` column. Decide on the evidence: what does the contract side hold for a `DateTime` literal default (dispatch 5 carries it as the SQL literal Prisma 7 writes), and what does the introspected side parse to? Make the comparison canonical on one representation without introducing local-time parsing; if the fix belongs in `sql-column-default-ir.ts`'s `resolvedDefaultsEqual` instead, say why.
3. **`ARRAY[...]` list defaults.** `ARRAY['a'::text, 'b'::text]`, `ARRAY[1, 2]`, and `ARRAY['x'::"MyEnum"]` must normalise to the same list default the `'{a,b}'` spelling produces. Handle nested quotes and empty arrays.

Then flip `supported.integration.test.ts` from `it.fails` to a passing test with zero findings and delete the finding list from its comment.

Out: the interpreter, unless one of the five turns out to be interpreter output after all (report which).

## Completed when

- [ ] Three regression tests, each red on its parent commit and green after, with the failing assertion quoted in the report.
- [ ] `pnpm --filter @internal/target-postgres test`, `typecheck`, `lint`, `build` green; `pnpm --filter @internal/adapter-postgres test` green; `pnpm --filter integration-tests test prisma7-source` green with `supported.integration.test.ts` asserting zero findings; `pnpm --filter integration-tests test introspect infer` green (blast radius: `contract infer` reads the same normaliser); root typecheck green.

## Halt conditions

- A fix changes what `contract infer` prints for an existing fixture. Report the diff before committing (it may be a correct improvement, but the orchestrator decides).
- Item 2 cannot be made canonical without changing the contract's literal representation for `DateTime` defaults. Report the two representations and stop.

## References

- Dispatch 5's report (the five paths and their raw defaults), `default-normalizer.ts`, `packages/2-sql/1-core/schema-ir/src/ir/sql-column-default-ir.ts:78-96`, dispatch 7 part 4's normaliser change in `control-adapter.ts`.
- Failure modes F13, F14, F24, F25; F5.

## Heartbeat and return shape

As dispatch 1.
