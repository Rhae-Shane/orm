# @internal/sql-contract-prisma7

Reads a Prisma 7 `schema.prisma` as a Prisma 8 contract source for the SQL family. During the side-by-side period Prisma 7 keeps owning the database and its migrations; this package lets `prisma contract emit` and `prisma db sign` read that schema directly, so no second schema file is needed until cutover.

## Responsibilities

- `prisma7Schema(path, options)` returns a `ContractConfig` (format `prisma7`) whose `source.load` reads the input, parses every `.prisma` file with `@internal/psl-parser`, and runs the Prisma 7 interpreter. A file input reads that file; a directory input reads every `.prisma` file directly under it, sorted by name (not recursive).
- The interpreter turns the Prisma 7 dialect into a validated SQL contract using the same lowering helpers as `@internal/sql-contract-psl`: models, columns, native types, namespaces (`@@schema`), and native enums. Every construct it does not support is a diagnostic with a span; nothing is changed silently.
- The Prisma 7 to Postgres native type table (`src/native-types.ts`) is derived from what `prisma@7.10.0` creates, recorded in `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` (item 6).

## Usage

```ts
import { defineConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default defineConfig({
  contract: prisma7Schema('prisma/schema.prisma'),
});
```

The package itself is target-neutral: the Postgres facade supplies the target pack, the namespace factory, and the names of the native enum entity kind and type constructor.

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
| `PRISMA7_RELATION_UNRESOLVED` | A field typed by another model. Relations are not interpreted yet. |
| `PRISMA7_UNKNOWN_ATTRIBUTE` | Any attribute the interpreter does not handle yet (`@id`, `@unique`, `@default`, `@updatedAt`, `@relation`, `@@id`, `@@unique`, `@@index`, ...). |
| `PRISMA7_SCHEMA_READ_FAILED` | The input path could not be read. |

Unknown top-level blocks keep the parser's `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` code.

## Not yet covered

Defaults, `@updatedAt`, keys, unique constraints, indexes, and relations fail loudly with `PRISMA7_UNKNOWN_ATTRIBUTE` or `PRISMA7_RELATION_UNRESOLVED` until they are implemented. Enum names are checked for duplicates within one file only.

## Tests

`test/fixtures/<case>/schema.prisma` with either `expected-contract.json` or `expected-diagnostics.json`; `test/fixtures.test.ts` runs every case through the real Postgres pack. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change.
