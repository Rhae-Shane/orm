# Dispatch 8: end-to-end proof through the CLI

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Prove the user-facing journey, such that a fixture app configured with `prisma7Schema('schema.prisma')` runs `contract emit`, `db sign`, and `db verify` through the real command family against a database built by Prisma 7's SQL, with exit 0 and zero findings.

## Scope

In:

- A CLI journey test under `test/integration/test/cli-journeys/`, modelled on `infer-roundtrip-fidelity.e2e.test.ts`, using `withDevDatabase`, `withClient` to run `supported/migration.sql`, a fixture app directory with a `prisma.config.ts` that uses `prisma7Schema` from `@prisma/orm-postgres/config`, and `runOnEngine` (or the `runContractEmit` / `runDbSign` / `runDbVerify` helpers in `journey-test-helpers.ts`, adding a helper only if one is missing).
- Assertions: `contract emit` exit 0 and writes `contract.json` and `contract.d.ts`; `db sign` exit 0; `db verify` exit 0 with zero findings in lenient mode; `--json` output of `contract emit` parses. A second case with a schema containing one hard-error construct (a `view`) asserts `contract emit` exits non-zero with one diagnostic naming the construct and writes no file.
- The test fails if any rule is removed (F13): show this by pointing at one rule (for example the `Cascade` on the junction FK) and stating what the test reports when it is broken.

Out: production code except a missing test helper. Docs (dispatch 9).

## Completed when

- [ ] `pnpm --filter integration-tests test cli-journeys/prisma7` (or the file's actual path filter) green; output saved under `wip/`.
- [ ] The hard-error case asserts the diagnostic code and that no output file exists.
- [ ] Root typecheck green.

## Halt conditions

- The fixture app cannot import `@prisma/orm-postgres/config` from under `test/integration` the way other journey fixtures do. Look at how existing fixtures wire the config before reporting.
- A finding remains that no rule in the slice spec covers. Report the path; do not filter.

## References

- `test/integration/test/cli.db-sign.e2e.test.ts`, `test/integration/test/utils/journey-test-helpers.ts`, `test/integration/test/utils/cli-test-helpers.ts:112-143`, `.agents/rules/cli-e2e-test-patterns.mdc`.
- Failure modes F13, F14, F28; F5.

## Heartbeat and return shape

As dispatch 1.
