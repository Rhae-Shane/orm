/**
 * What Prisma 7.10.0 creates in Postgres for each Prisma 7 scalar and `@db.*`
 * native type, expressed as the Prisma 8 authoring type constructor that
 * produces the same column. Derived from the SQL recorded in
 * `test/integration/test/fixtures/prisma7-source/reference/migration.sql`.
 * `args` are the constructor's positional arguments; a `@db.*` entry passes
 * the attribute's own arguments through.
 */
export const prisma7PostgresTypeMap = {
  scalars: {
    String: { constructorName: 'String', args: [] },
    Boolean: { constructorName: 'Boolean', args: [] },
    Int: { constructorName: 'Int', args: [] },
    BigInt: { constructorName: 'BigInt', args: [] },
    Float: { constructorName: 'Float', args: [] },
    Decimal: { constructorName: 'Numeric', args: ['65', '30'] },
    DateTime: { constructorName: 'Timestamp', args: ['3'] },
    Json: { constructorName: 'Jsonb', args: [] },
    Bytes: { constructorName: 'Bytes', args: [] },
  },
  nativeTypes: {
    Text: 'String',
    VarChar: 'VarChar',
    Char: 'Char',
    Uuid: 'Uuid',
    Inet: 'Inet',
    Boolean: 'Boolean',
    Integer: 'Int',
    SmallInt: 'SmallInt',
    BigInt: 'BigInt',
    Real: 'Real',
    DoublePrecision: 'Float',
    Decimal: 'Numeric',
    Timestamp: 'Timestamp',
    Timestamptz: 'Timestamptz',
    Date: 'Date',
    Time: 'Time',
    Timetz: 'Timetz',
    Json: 'Json',
    JsonB: 'Jsonb',
    ByteA: 'Bytes',
  },
} as const;
