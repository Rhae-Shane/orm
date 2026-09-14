# Dispatch 2: a "now" generator that `timestamp` columns can encode

**Slice spec:** `projects/prisma7-contract-source/slices/04-prisma7-adoption-example/spec.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Make an ORM-side "now" default work on a Postgres `timestamp` (without time zone) column, such that a Prisma 7 `@updatedAt` field and Prisma 8's own `temporal.timestamp(onUpdate: now)` both advance on update instead of failing with `RUNTIME.ENCODE_FAILED`, and the example's update step runs.

The property this preserves: a generator produces a value in the representation the column's codec encodes; the codec is not loosened to accept a foreign representation.

## Scope

In, one commit per part:

1. **Prisma 8 defect, in the Postgres target.** `temporal.timestamp(...)` (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:752`) pairs codec `pg/timestamp-temporal@1` with the `instantNow` generator, whose value is a `Temporal.Instant` the codec rejects. Add a generator whose value is the current moment as a `Temporal.PlainDateTime` in UTC (Prisma 7 stores UTC wall-clock time in `timestamp(3)`, so this is also the semantics a migrated app expects), registered on both the control and runtime planes the way `instantNow` is (`packages/3-targets/3-targets/postgres/src/core/instant-now-generator.ts` and its runtime counterpart), and make the `temporal.timestamp` and `temporal.timestampString` presets use it. `temporal.timestamptz` keeps `instantNow`. Regression test, red on the parent commit: interpret a PSL schema with `updatedAt temporal.timestamp(3, onCreate: now, onUpdate: now)`, run a create and an update through the ORM against `withDevDatabase`, assert the column advanced and the round-tripped value is a `PlainDateTime`. Also assert the existing `timestamptz` preset still works.
2. **The Prisma 7 source uses it.** `packages/3-extensions/postgres/src/config/prisma7-schema.ts` maps `@updatedAt` to the new generator when the column is `timestamp` and to `instantNow` when a `@db.Timestamptz` override makes it `timestamptz`. Fixture expectations in `@internal/sql-contract-prisma7` update accordingly; the `supported-verify` proofs stay at zero findings (a generator is ORM-side, so verify is unaffected; confirm).
3. **The example's update step.** `examples/prisma7-adoption/src/main.ts` gets its update back (update a post, print the before and after `updatedAt`), `test/adoption.test.ts` asserts `updatedAt` advanced, README's "What a Prisma 7 user meets" list drops the defect line and the surprise list is otherwise kept.

Out: any codec change; Mongo; the timestamp-string variants beyond pointing them at the right generator.

## Completed when

- [ ] Part 1's regression test is red on its parent commit (quote the `ENCODE_FAILED` assertion) and green after; `pnpm --filter @internal/target-postgres test`, `typecheck`, `lint`, `build` green; the family and adapter suites that touch generators green (`pnpm --filter @internal/sql-runtime test` or whichever package owns `applyMutationDefaults`, and `@internal/adapter-postgres`).
- [ ] `pnpm --filter @internal/sql-contract-prisma7 test` and `pnpm --filter integration-tests test prisma7-source cli-journeys/prisma7-source` green.
- [ ] `pnpm --filter prisma7-adoption test` green with the `updatedAt` assertion; `pnpm start` output saved under `wip/example/step-start-2.log` shows the advance.
- [ ] Root `pnpm typecheck` and `pnpm lint:deps` green; `pnpm fixtures:check` green if any emitted fixture carries the `temporal.timestamp` preset (check with a grep first).

## Halt conditions

- Generator ids are part of the contract's execution hash and an existing committed fixture's hash changes: report which fixtures and stop before regenerating (the artefact-format rule in `drive/calibration/dod.md` applies).
- The runtime generator registry cannot express a per-codec choice without a shape change in `packages/2-sql/5-runtime`: report the shape and stop.

## References

- `packages/2-sql/9-family/src/core/timestamp-now-generator.ts` and `timestamp-now-runtime-generator.ts`, `packages/3-targets/3-targets/postgres/src/core/instant-now-generator.ts`, `packages/2-sql/5-runtime/src/sql-context.ts:663-715` (`applyMutationDefaults`), the `pg/timestamp-temporal@1` codec, `wip/example/step-start.log` for the failure.
- Failure modes F13, F14, F17, F24, F25; F5.

## Heartbeat and return shape

As dispatch 1 of slice 1.
