# Prisma 7 reference fixture

`schema.prisma` exercises every construct in the slice 1 rule table (`projects/prisma7-contract-source/slices/01-postgres-source/spec.md`). `migration.sql` is what Prisma 7.10.0 generates for it against an empty Postgres database. Both files are the ground truth for the Prisma 7 interpreter; rules are written against this SQL, not from memory.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0` (schema engine `0edf323efd1d98336f3f0a68684b56f689b900d3`).
- Date: 2026-09-13.
- Run from a scratch directory (`wip/prisma7-reference/`, gitignored) containing a copy of `schema.prisma` and this `prisma.config.ts`:

```ts
export default {
  schema: 'schema.prisma',
  datasource: { url: 'postgresql://prisma:prisma@localhost:5432/reference' },
};
```

- Command:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```

Notes on the run:

- Prisma 7 removed `--to-schema-datamodel`; the flag is now `--to-schema`.
- Without a config file the schema engine exits with `The following required arguments were not provided: --datasource <JSON>` and the CLI prints nothing. The URL in `prisma.config.ts` is a placeholder; a `--from-empty` diff never connects to it.
- `prisma validate` accepts the schema with one warning: `Preview feature "multiSchema" is deprecated. The functionality can be used without specifying it as a preview feature.` The schema keeps `previewFeatures = ["multiSchema", "views"]` because the slice spec says the interpreter must ignore preview features other than `multiSchema`.
- Prisma 7 rejected no construct in the schema. Nothing was removed.
- The `view UserSummary` block produces no SQL. Prisma Migrate does not create views.
