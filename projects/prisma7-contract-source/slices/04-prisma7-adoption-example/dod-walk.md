# Slice 4 Definition of Done walk — 2026-09-14

Walked by the orchestrator against the slice spec's checklist and the team overlay in `drive/calibration/dod.md`. Reviewer verdict on the slice: complete and ready; dispatch 2 satisfied with no findings, dispatch 1 round 2 satisfied. Tip `6d70c12cc0` plus this walk.

## Slice-specific items (slice spec)

- ✓ `pnpm --filter prisma7-adoption test` runs the full story green on a fresh dev database (`wip/example/test-4.log`); `turbo run test --filter='./examples/**'` lists the example, so the examples CI job picks it up without a workflow change.
- ✓ `pnpm start` shows users with posts and tags through the junction and `updatedAt` advancing (`wip/example/step-start-2.log`); `pnpm v7:read` shows the same rows through the Prisma 7 client.
- ✓ README follows the guide's phase order, names the guide, shows both config forms, states the Prisma 5 junction caveat and the hard-error rule, and points at phase 4 for cutover.
- ✓ `packages/3-extensions/postgres/README.md` Quick Start and `prisma7Schema` section show the published `prisma/config` form first, the workspace form once for contributors.
- ✓ Lockfile change is the example's closure plus one benign `pg-mem` snapshot re-key; no framework, family, target, or extension package depends on Prisma 7 (the one workspace policy change is a pinned `trustPolicyExclude` for `prisma@7.10.0`, commented).
- ✓ `docs/onboarding/Getting-Started.md` lists the example.

## Team overlay, plan-side

- ✓ `pnpm fixtures:check` exit 0 with a clean tree after the generator change; `pnpm lint:deps` clean; root typecheck green.

## Team overlay, PR-side

- ✗ Linear issue, ticket-prefixed PR title, Linear link: operator items, as for slice 1. Slice 4 ships in the same PR as slice 1 by the operator's request to see the feature demonstrated; the PR text in `wip/pr-slice-01.md` covers both.
- ✓ No `projects/` references in long-lived files (grep gate).
- ✓ `origin/main` was merged in slice 1's dispatch 9; no new conflicts since.

## Team overlay, QA-side

- N/A for a separate QA run: the example is itself the end-user QA of slice 1's surface, run for real through both CLIs on a fresh database, and its README is the script. The slice 1 QA runner's report stands for the `prisma7Schema` surface.

## Dispatch DoD overlay

- ✓ Failure modes checked; no destructive git operations; the only fixture regenerations are the example's own contract and signed snapshot and the Prisma 7 `updated-at` expectation, all owned by this slice.
- ✓ Gotcha records written for the four user-facing surprises; Linear filing left to the operator, stated in each entry.
