# Handover: Prisma 7 to 8 upgrade path, and `orm init` Prisma 7 detection

Written 2026-09-14 at the end of a design session with Will. Read this first, then the transcript for the reasoning behind each decision.

Transcript of the session (Claude Code JSONL, readable with `jq -r '.message.content'` or any text viewer): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-prisma--claude-worktrees-prisma-upgrade-spec-validation-363dfe/218cff9c-08b3-46dd-8d52-7449648bfe3e.jsonl`

Branch: `worktree/prisma-upgrade-spec-validation-363dfe`, pushed to the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`). No code changed. This directory is the only addition.

## What the session started from

A spec for a new command, `prisma upgrade`, that would automate the whole Prisma 7 to 8 guide in one run: set Prisma 7 aside under `@prisma/prisma7`, install Prisma 8, convert `schema.prisma` to `contract.prisma`, emit, edit tsconfig, sign the database, report remaining work. It depended on a separate schema-converter spec. Neither spec is in the repo; the upgrade spec was pasted into the session and is in the transcript's first message.

## What validation found

1. `@prisma/prisma7` (npm, only version 7.10.0) exports no parser, and `@internal/psl-parser` did not read `datasource` or `generator` blocks. The spec's converter design could not be built as written.
2. Prisma 7 requires CLI and client at the same version, so side by side forces `@prisma/client` to 7.10.0.
3. `db sign` does not yet set the `db` ref. That is PR prisma/prisma#30251, open and mergeable at the time of writing. The spec assumed it landed.
4. `orm init` emits by spawning the project's installed `prisma` binary, not in-process.
5. Prisma 7 projects import the generated client from a generator `output` path such as `generated/prisma`, not from `@prisma/client`.
6. The example repo `prisma/prisma8-and-7-example` tag `step-2`, not `step-1`, is the state after Prisma 8 is added. It uses `prisma8/contract.prisma` and `generated/prisma8/`.
7. The Mongo guide is a one-shot port of a Prisma 6 project, not a side-by-side guide.
8. An orchestrator cannot reliably find its inputs in an arbitrary project: computed config values, multi-file schemas, monorepos, and callers of `prisma migrate` in CI files it must not edit.
9. A parallel project already solves the hard part differently and better: `projects/prisma7-contract-source/` in worktree `prisma-schema-contract-converter-04eaed`. Prisma 8 reads `prisma/schema.prisma` directly as a contract source via `contract: prisma7Schema('prisma/schema.prisma')`. No converted file, no hand edits. `contract convert` prints Prisma 8 PSL once at cutover. Slice 1 (Postgres) was well underway; slice 2 is Mongo; slice 3 the converter; slice 4 an example app.

## Decisions Will made

- **The `prisma upgrade` orchestrator is dropped.** Not to be built.
- **`orm init` behaves like `git init`.** It sets up what Prisma 8 needs to operate in a project and stops. It never connects to or writes the database. It is not a migration command. Saved to memory as `orm-init-behaves-like-git-init`.
- **Init gains Prisma 7 detection, scoped as follows.**
  - Flag: `--from-prisma7-schema <path>`. Names the dialect on purpose, because init must write `prisma7Schema(...)` as the contract source rather than treat the file as Prisma 8 PSL.
  - Interactive: when init finds a Prisma 7 `prisma.config.ts` or a `prisma/schema.prisma` with a `datasource` block, it asks one question, use it as the contract source or not. No silent mode switch.
  - The Prisma 7 config and schema fill defaults only: schema path, family from `datasource.provider`, connection expression to carry into the new config. Any flag given (`--target`, `--schema-path`, and so on) overrides them. They are not errors.
  - Detection of a Prisma 7 config uses the engine's existing check: `definePrismaConfig` stamps a `$prismaConfig` version marker, and the loader already reports a missing marker as "most likely a Prisma 7 config". Evaluate the file, and when the marker is absent read the Prisma 7 object for `schema`, `migrations.path`, `datasource.url`.
  - Init writes its normal files with no starter schema; the config points at the existing schema. `db.ts` goes under `src/prisma/`, never under `prisma/`, which Prisma 7 owns.
  - Init does not sign. `db sign` is the first printed next step, followed by: rewrite routes, re-run `contract emit` and `db sign` after each `prisma7 migrate dev`, `contract convert` at cutover.
  - Init never renames the Prisma 7 config, never edits scripts it did not add, never uninstalls anything, and must not set `"type": "module"` in an existing project (warn only). When `prisma.config.ts` is Prisma 7's, init stops and prints the rename command from section 1 of the guide.
- **Rejected ideas, do not re-propose:** emitting a `contract.ts` module or any generated code beside `contract.json` (the product emits a data artifact plus types only, see `docs/Architecture Overview.md`); signing inside init.

## Verified experiment: CommonJS projects need no module change

Node 24.13, TypeScript 5.9.3, workspace build. A plain `.cjs` file can `require("./contract.json")` and `require("@prisma/orm-postgres/runtime")` and construct the client. A `.cts` file importing both, without the `with { type: "json" }` attribute, typechecks under `"module": "nodenext"`. `node16` fails (TS1479), `node10` cannot resolve the package. Details and the docs consequences are in `docs-brief-module-settings.md` in this directory, which Will asked for to hand to a docs agent.

Follow-up for init noted there: scaffold `db.ts` with the attribute-free JSON import when `package.json` lacks `"type": "module"`.

## What the next agent should do

1. Read the transcript for context. Read `projects/prisma7-contract-source/` in worktree `prisma-schema-contract-converter-04eaed` (or wherever it has landed) for the contract-source API init will write against.
2. Tell the owners of that project two things: slices 3 and 4 describe cutover as `migration plan --name baseline` plus `migration ref set`, which PR #30251 collapses to `db sign`; and the `orm init` detection mode will consume `prisma7Schema` from `@prisma/orm-postgres/config` and later `@prisma/orm-mongo/config`.
3. Shape the init change as a Drive project (`/drive-process`) with the scope above. Dependencies: slice 1 of the parallel project for Postgres, slice 2 for Mongo, PR #30251 for the next-steps text to be accurate.
4. Hand `docs-brief-module-settings.md` to the docs agent for the `prisma/web` guides.
5. Optional: verify the `require()` result against the published `@prisma/orm-postgres` rather than the workspace build before the docs page goes live.

## Facts the next agent will otherwise have to rediscover

- Command tree: `packages/1-framework/3-tooling/cli/src/orm/family.ts` maps command keys; the key spells the unified CLI's mount path; the host is the `prisma-cli` repo.
- Init: `packages/1-framework/3-tooling/cli/src/orm/init.ts`, `init-inputs.ts` (prompts and flags), `init-scaffold.ts` (files written, tsconfig and gitignore merge), `init-emit.ts` (spawns `contract emit`), `commands/init/hygiene-package-scripts.ts` (`ensureEsmModuleType` sets `"type": "module"`).
- Init tsconfig defaults: `commands/init/templates/tsconfig.ts` writes `module: preserve`, `moduleResolution: bundler`, `resolveJsonModule: true`.
- Prisma 8 config loader: `@prisma/cli-engine` `loadConfig`, cwd only, `prisma.config.ts` only, checks the `$prismaConfig` marker.
- `db update` already supports `--confirm <token>` for non-interactive destructive consent.
- `@prisma/orm-postgres` ships ESM only (`dist/*.mjs`), bundles `pg`.
- Guides: `prisma/web` `apps/docs/content/docs/guides/upgrade-prisma-orm/{postgresql,mongodb}.mdx`.
