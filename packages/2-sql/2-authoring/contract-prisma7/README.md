# @internal/sql-contract-prisma7

Reads a Prisma 7 `schema.prisma` as a Prisma 8 contract source for the SQL family. During the side-by-side period Prisma 7 keeps owning the database and its migrations; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma7Schema(path, options)` returns a `ContractConfig` (format `prisma7`) whose `source.load` reads the input, parses every `.prisma` file with `@internal/psl-parser`, and runs the Prisma 7 interpreter. A file input reads that file; a directory input reads every `.prisma` file directly under it, sorted by name (not recursive).
- The interpreter turns the Prisma 7 dialect into a validated SQL contract using the same lowering helpers as `@internal/sql-contract-psl`: models, columns, native types, namespaces (`@@schema`), and native enums. Every construct it does not support is a diagnostic with a span; nothing is changed silently.
- `src/native-types.ts` holds only the mapping mechanism. The table of what Prisma 7 creates for each scalar and `@db.*` type is target knowledge: the Postgres one is `prisma7PostgresTypeMap` in `@internal/target-postgres/prisma7-type-map`, derived from what `prisma@7.10.0` creates (`projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md`, item 6), and the facade passes it in as `typeMap`.

## Usage

```ts
import { defineConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default defineConfig({
  contract: prisma7Schema('prisma/schema.prisma'),
});
```

The package itself is target-neutral: the Postgres facade supplies the target pack, the namespace factory, the type map, and the names of the native enum entity kind and type constructor.

## Diagnostics

Codes are prefixed `PRISMA7_`:

| Code | Meaning |
|---|---|
| `PRISMA7_PROVIDER_MISMATCH` | No `datasource` block, or its `provider` is not `postgresql` / `postgres`. |
| `PRISMA7_RELATION_MODE_UNSUPPORTED` | `relationMode = "prisma"`. |
| `PRISMA7_VIEW_UNSUPPORTED` | A `view` block. |
| `PRISMA7_UNSUPPORTED_TYPE` | `Unsupported("...")` or an unknown field type. |
| `PRISMA7_NATIVE_TYPE_UNSUPPORTED` | A `@db.*` type with no Prisma 8 codec (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, or any unknown spelling). |
| `PRISMA7_ENUM_NAMESPACE_MISMATCH` | A field uses an enum declared in a different `@@schema`; a Postgres enum type lives in one schema and Prisma 8 columns reference the enum of their own namespace. |
| `PRISMA7_RELATION_UNRESOLVED` | A relation field that cannot be paired: no matching side, an ambiguous unnamed pair, a singular back-relation over a non-unique foreign key, a `fields`/`references` mismatch, or a relation whose optionality disagrees with its foreign key fields. |
| `PRISMA7_JUNCTION_ID_UNSUPPORTED` | An implicit many-to-many relation on a model without a single-field `@id` (a composite id, for example). Prisma 7 forbids it too. |
| `PRISMA7_UNKNOWN_ATTRIBUTE` | Any attribute the interpreter does not handle yet (`@default`, `@updatedAt`, `@@index`, ...). |
| `PRISMA7_TABLE_COLLISION` | Two models map to the same table in the same schema; reported on every model in the group. |
| `PRISMA7_SCHEMA_READ_FAILED` | The input path could not be read. |

Unknown top-level blocks keep the parser's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` code.

## Relations

Explicit relations keep their fields, references, and actions; an omitted `onDelete` becomes `Restrict` when every foreign key field is required and `SetNull` when one is optional, an omitted `onUpdate` becomes `Cascade`, and both are always written. `map` is ignored because foreign key names are not verified. One-to-one is recognised by `@unique` on the foreign key fields. An implicit many-to-many relation (a list field on both sides) becomes the junction Prisma 7 creates: model `AToB` (models in alphabetical order, or the relation name), table `_AToB`, columns `A` and `B` typed like the two ids, primary key `(A, B)`, index `_AToB_B_index`, two cascading foreign keys, and relation fields `a` and `b`. `A` is the model with the smaller name in plain string order; for a self-relation, the field with the smaller name, which is prisma-engines' own rule (`psl/parser-database/src/relations.rs`, `ingest_relation`). A relation over an `@ignore`d field or to an `@@ignore`d model is omitted on both sides. Pairing reuses `@internal/sql-contract-psl/resolution`.

`@id`, `@@id`, `@unique`, and `@@unique` are read because relations depend on them (one-to-one detection, junction column types) and become the primary key and unique constraints.

## Not yet covered

Defaults, `@updatedAt`, and `@@index` fail loudly with `PRISMA7_UNKNOWN_ATTRIBUTE` until they are implemented. Enum names are checked for duplicates within one file only.

## Tests

`test/fixtures/<case>/schema.prisma` with either `expected-contract.json` or `expected-diagnostics.json`; `test/fixtures.test.ts` runs every case through the real Postgres pack. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change.
