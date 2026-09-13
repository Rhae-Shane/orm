# Dispatch 9: docs and closing gates

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Document the Prisma 7 source for Postgres users and bring the whole branch through the repo-wide gates, such that a reader of the config reference can adopt a Prisma 7 schema without reading this project folder, and the slice is ready for a pull request.

## Scope

In:

- **Config reference.** Wherever `packages/3-extensions/postgres` documents `defineConfig` (its README and any `docs/` page that describes `contract:`), add `prisma7Schema(path)`: what it accepts (a file or a directory of `.prisma` files), what it produces, that Prisma 7 keeps owning migrations during the transition, the `db sign` routine after each Prisma 7 migration, and a table of every construct that is a hard error with the exact edit that unblocks it (read the codes from `packages/2-sql/2-authoring/contract-prisma7/src/diagnostics.ts`, not from the project spec, F23). State that databases last migrated on Prisma 5 or earlier must migrate on Prisma 7 first because of the junction primary key. Plain English, no hard-wrapped prose.
- **Package README** for `@internal/sql-contract-prisma7`: Responsibilities, the rule table in short form, and how fixtures are updated (`UPDATE_PRISMA7_FIXTURES=1`).
- **Type map README note** in the Postgres target for `prisma7-type-map.ts`, one paragraph.
- **Closing gates** on the branch tip: `pnpm build`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:manifests`, `pnpm test:packages`, `pnpm fixtures:check` (note `fixtures-check-needs-second-install`: install, build, install again before judging a red), `pnpm test:integration` for `prisma7-source` and the adapter's `schema-verify` files, root `pnpm typecheck`. Save every output under `wip/gates/` and quote the pass lines.
- **Grep gates:** no `projects/` references in any file outside `projects/`; no `any`; no file-extension imports; no `@ts-expect-error` outside `*.test-d.ts` in the new package; run the `drive/calibration/grep-library.md` § Cross-cutting patterns and quote the empty results.
- **Sync with `origin/main`** before the final gate run: `git fetch origin && git merge origin/main` (never rebase, never reset), resolve conflicts if any and say which files, then rerun the always-run gates.

Out: new behaviour. If a gate exposes a defect in earlier dispatches, fix it in a separate commit that names the dispatch, and report it.

## Completed when

- [ ] Every gate above green on the merged tip, outputs saved and quoted.
- [ ] Config reference and both READMEs updated; `pnpm lint:docs` green.
- [ ] Grep gates empty.

## Halt conditions

- `fixtures:check` red after the second install with drift in fixtures this branch never touched: report the file list, do not commit regenerated unrelated fixtures (F25).
- A merge conflict in a file outside this branch's surface: report before resolving.

## References

- `.agents/rules/doc-maintenance.mdc`, `.agents/rules/git-staging.mdc`, `docs/CLI Style Guide.md` for wording, `packages/1-framework/3-tooling/cli/README.md` for the reference style.
- Failure modes F12 (exhaustive doc sweep), F14, F23, F24, F25, F27 (never checkout or reset mid-merge); F5.

## Heartbeat and return shape

As dispatch 1, plus the list of gate output files.
