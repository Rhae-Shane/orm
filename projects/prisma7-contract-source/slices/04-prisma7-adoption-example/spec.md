# Slice 4: the Prisma 7 adoption example app

_Parent project: `projects/prisma7-contract-source/`. Linear: to be created. Outcome: an example app under `examples/` shows a real Prisma 7 project adopting Prisma 8 side by side, with Prisma 7 still running its migrations and Prisma 8 reading the same database through the Prisma 7 schema._

## At a glance

```bash
cd examples/prisma7-adoption
pnpm db:start        # in-process Postgres, writes DATABASE_URL to .env
pnpm v7:migrate      # Prisma 7 applies its own migrations (real prisma@7.10.0)
pnpm v8:emit         # Prisma 8 reads prisma/schema.prisma through prisma7Schema
pnpm v8:sign         # verifies the database and records the marker
pnpm seed            # writes rows
pnpm start           # Prisma 8 ORM queries: users with posts and tags, create a post connected to tags
pnpm v7:migrate:2    # Prisma 7 adds a column; then v8:emit and v8:sign again, nothing else changes
pnpm test            # the whole story as one vitest run
```

## Chosen design

- **A real Prisma 7 install.** `package.json` depends on Prisma 7 under the package-manager alias the transition guide prescribes (`prisma-v7`, resolving to `prisma@7.10.0`) and whatever Prisma 7 needs to run migrations against a URL (`@prisma/adapter-pg` and `pg` if Prisma 7.10 requires a driver adapter for `migrate`). Prisma 8 comes from the workspace like every other example. This is the one place in the repo that installs Prisma 7, and it is deliberate: the example exists to show the two side by side.
- **Two config files.** Prisma 7 reads `prisma7.config.ts` (its `defineConfig` from `prisma/config`, datasource URL from `.env`, migrations under `prisma/migrations/`), passed with `--config`. Prisma 8 reads `prisma.config.ts` (`definePrismaConfig` from `@prisma/cli-engine` with `orm: ormConfig({ contract: prisma7Schema('prisma/schema.prisma'), db: { connection } })`).
- **The binary collision is shown, not hidden.** Both CLIs install a bin named `prisma`. The example runs Prisma 7 through an explicit script (`"prisma7": "node node_modules/prisma-v7/build/index.js"`) and says why in the README. The `parallel-install.md` assumption that Prisma 8 ships as `prisma-next` is stale; the README states the current situation.
- **Database.** In-process Postgres from `@prisma/dev` as the other examples do; `db:start` writes `DATABASE_URL` into `.env`; `db:stop` or process exit tears it down.
- **Schema.** A realistic Prisma 7 blog schema: `User` (`id`, `email @unique`, `name?`, `role Role @default(USER)`, `createdAt @default(now())`, `updatedAt @updatedAt`, `posts`), `Post` (`id`, `title`, `content?`, `published Boolean @default(false)`, `author` with `onDelete: Cascade`, `tags Tag[]`, `@@index([authorId])`), `Tag` (`id`, `name @unique`, `posts Post[]`), enum `Role`. Two Prisma 7 migrations committed under `prisma/migrations/`: the initial one, and one that adds `Post.viewCount Int @default(0)`.
- **Queries.** `src/main.ts` uses the Prisma 8 ORM client: list users with their posts and tags (the implicit many-to-many through `_PostToTag`), create a post connected to existing tags, update a post and show `updatedAt` advanced by the Prisma 8 generator. If Prisma 7's generated client can also be run in the same app without fighting the Prisma 8 install, `src/v7-read.ts` reads the same rows through Prisma 7 to show both clients on one database; if not, the README says why and the slice still passes.
- **Test.** `test/adoption.test.ts` runs the whole story in order against a fresh dev database: migrate on 7, emit, sign, verify zero findings, seed, query through 8, migrate again on 7, emit and sign again, verify zero findings. It is wired into whatever CI job runs the other examples' tests.

## Edge cases

| Case | Disposition |
|---|---|
| `pnpm-workspace.yaml` policy blocks `prisma@7.10.0` (release cooldown, `allowBuilds`, `trustPolicy`) | Add the minimal policy entry with a comment naming this example; if a postinstall must be allowed, list the exact package and version. Halt if the policy would need a global relaxation. |
| Prisma 7 `migrate deploy` cannot reach PGlite through its adapter | Fall back to applying the committed migration SQL with `pg` for the test, keep `v7:migrate` as the documented command, and record the reason in the README. |
| `contract.d.ts` imports workspace-internal names | The example's `package.json` depends on `@prisma/orm-postgres`, as the README for `prisma7Schema` requires. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] `pnpm --filter prisma7-adoption test` runs the full story green on a fresh dev database, and the example is included wherever CI runs example tests.
- [ ] `pnpm start` output shows users with posts and tags read through the junction, and an `updatedAt` that advances on update.
- [ ] README walks a Prisma 7 user through the story in order and states the binary collision, the two config files, the Prisma 5 junction caveat, and the hard-error rule.
- [ ] The workspace lockfile change is the example's dependencies only; no framework, family, target, or extension package depends on Prisma 7.
- [ ] `docs/` mention of the example added where the other examples are listed.
