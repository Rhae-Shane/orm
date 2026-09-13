# Prisma 7 relations fixture

`schema.prisma` is `../supported/schema.prisma` reduced to what the Prisma 7 contract source interprets today: the relation models (`User`, `Post`, `Tag`, `Profile`, `Settings`, `Composite`, `AuditLog`, `LegacyThing`) and both enums, with every default (`@default(...)`, `@updatedAt`) and every `@@index` removed, and the `Scalars`, `NativeTypes`, `Timestamps`, and `Defaults` models dropped. It predates default and index support and keeps the relation shapes isolated; keys, uniques, and relations are unchanged from `supported/`. The full schema is verified by `supported-verify/`.

There is no `migration.sql` here on purpose: the test applies `../supported/migration.sql`, the SQL Prisma 7.10.0 generated for the full schema, so the database is exactly what Prisma 7 builds. The interpreted contract verifies with zero findings.
