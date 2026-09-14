# Dispatch 1: the adoption example app

**Slice spec:** `projects/prisma7-contract-source/slices/04-prisma7-adoption-example/spec.md` (rewritten 2026-09-14 against the public upgrade guide; discard the earlier version's alias and binary-collision assumptions)
**Model tier:** Fable (implementer). **Time-box:** one session; commit the working subset at half budget if the Prisma 7 client half is not done.

## Task

Build `examples/prisma7-adoption` exactly as the slice spec's Chosen design describes, such that a Prisma 7 user who has read the public upgrade guide can clone it, run the README's commands in order, and watch Prisma 7 migrate while Prisma 8 adopts, signs, verifies, and queries the same database with no hand-edited contract.

## Scope

In: everything in the slice spec, plus the one-paragraph README fix it names in `packages/3-extensions/postgres/README.md` (the published import is `definePrismaConfig` from `prisma/config`; the workspace form is `@prisma/cli-engine`; show the published form first). Read the guide yourself first: https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql (use WebFetch). Model the package layout, scripts, `@prisma/dev` usage, vitest config, biome config, and README shape on `examples/prisma-8-demo`; find how those examples' tests run in CI (`.github/workflows/`, root `package.json` scripts, turbo config) and include this one the same way. Install with `pnpm install` from the repo root after editing the example's `package.json`; check `pnpm-workspace.yaml` policy (`minimumReleaseAge`, `allowBuilds`, `trustPolicy`) before installing and add the minimal pinned entry if a Prisma 7 package needs one, with a comment. The lockfile diff must be the example's dependencies and their closure only.

Out: changes under `packages/` other than the README paragraph. If the example needs one, that is a halt.

## Completed when

- [ ] Every command in the slice's At a glance block works in order from a clean checkout, outputs saved under `wip/example/`.
- [ ] `pnpm --filter prisma7-adoption test`, `typecheck`, `lint` green; root `pnpm typecheck` green; `pnpm lint:deps` green; `pnpm lint:docs` green; the CI wiring change is shown.
- [ ] `git diff origin/main -- pnpm-lock.yaml` contains only entries for this example's dependencies and their transitive closure.

## Halt conditions

- Workspace policy would need a global relaxation to install a Prisma 7 package.
- `prisma7 migrate deploy` or `prisma7 generate` cannot run against the `@prisma/dev` database or without network in CI.
- The example needs a change under `packages/` beyond the README paragraph.

## References

- The upgrade guide above; `examples/prisma-8-demo/`; `packages/3-extensions/postgres/README.md` § `prisma7Schema`; `test/integration/test/fixtures/prisma7-source/reference/README.md` (how Prisma 7.10 was driven for `migrate diff`, the config requirement).
- Failure modes F3, F13, F14, F23 (read the guide and the code, not the project spec, for API names), F24; F5. Grep gates § Cross-cutting anti-patterns. No `projects/` references in the example.

## Heartbeat and return shape

As dispatch 1 of slice 1, plus a list of every surprise a Prisma 7 user following the guide would hit (these become README lines and gotcha records).
