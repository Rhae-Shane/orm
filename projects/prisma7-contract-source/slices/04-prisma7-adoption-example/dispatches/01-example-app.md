# Dispatch 1: the adoption example app

**Slice spec:** `projects/prisma7-contract-source/slices/04-prisma7-adoption-example/spec.md`
**Model tier:** Fable (implementer). **Time-box:** one session; commit the working subset at half budget if the Prisma 7 client half is not done.

## Task

Build `examples/prisma7-adoption` exactly as the slice spec's Chosen design describes, such that a Prisma 7 user can clone it, run the commands in its README in order, and watch Prisma 7 migrate while Prisma 8 adopts, signs, verifies, and queries the same database.

## Scope

In: everything in the slice spec. Model the package layout, scripts, `@prisma/dev` usage, vitest config, biome config, and README shape on `examples/prisma-8-demo` and `examples/prisma-8-demo-sqlite`; find how those examples' tests run in CI (`.github/workflows/`, root `package.json` scripts, turbo config) and include this one the same way. Install with `pnpm install` from the repo root after editing the example's `package.json`; the lockfile diff must be the example's dependencies only. Check `pnpm-workspace.yaml` policy (`minimumReleaseAge`, `allowBuilds`, `trustPolicy`) before installing and add the minimal entry if Prisma 7 needs one, with a comment.

Out: changes to any package under `packages/`. If the example needs one, that is a halt.

## Completed when

- [ ] Every command in the slice's At a glance block works in order from a clean checkout (`pnpm db:start`, `v7:migrate`, `v8:emit`, `v8:sign`, `seed`, `start`, `v7:migrate:2`, `v8:emit`, `v8:sign`, `test`), outputs saved under `wip/example/`.
- [ ] `pnpm --filter prisma7-adoption test`, `typecheck`, `lint` green; root `pnpm typecheck` green; `pnpm lint:deps` green; the CI wiring change is shown.
- [ ] `git diff origin/main -- pnpm-lock.yaml` contains only entries for this example's dependencies and their transitive closure.

## Halt conditions

- Workspace policy would need a global relaxation to install Prisma 7.
- Prisma 7 refuses to run against the dev database in a way the fallback in the slice spec cannot cover.
- The example needs a change under `packages/`.

## References

- `examples/prisma-8-demo/` (scripts, `@prisma/dev` usage, README), `packages/3-extensions/postgres/README.md` § `prisma7Schema`, `test/integration/test/fixtures/prisma7-source/reference/README.md` (how Prisma 7.10 was driven, `--to-schema`, the config requirement), `projects/prisma-8-rc1/parallel-install.md` (the story; note its `prisma-next` naming is stale).
- Failure modes F3, F13, F14, F24; F5. Grep gates § Cross-cutting anti-patterns. No `projects/` references in the example.

## Heartbeat and return shape

As dispatch 1 of slice 1, plus a list of every surprise a Prisma 7 user would hit (these become README lines and gotcha records).
