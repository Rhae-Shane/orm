# Prisma 7 relations fixture

`schema.prisma` is `../supported/schema.prisma` reduced to what the Prisma 7 contract source interprets today: the relation models (`User`, `Post`, `Tag`, `Profile`, `Settings`, `Composite`, `AuditLog`, `LegacyThing`) and both enums, with every default (`@default(...)`, `@updatedAt`) and every `@@index` removed, and the `Scalars`, `NativeTypes`, `Timestamps`, and `Defaults` models dropped. Defaults and indexes are hard errors until the Prisma 7 source interprets them; keys, uniques, and relations are unchanged from `supported/`.

There is no `migration.sql` here on purpose: the test applies `../supported/migration.sql`, the SQL Prisma 7.10.0 generated for the full schema, so the database is exactly what Prisma 7 builds. Findings about the constructs this file leaves out are expected and filtered by the test; relation paths must verify clean.
