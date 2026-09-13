/**
 * What Prisma 7.10.0 creates in Postgres, expressed as the Prisma 8 authoring
 * type constructor that produces the same column. Derived from
 * `test/integration/test/fixtures/prisma7-source/reference/migration.sql` and
 * recorded in verification-results.md item 6.
 */
export interface Prisma7TypeMapping {
  readonly constructorName: string;
  readonly args: readonly string[];
}

const scalarTypes: Readonly<Record<string, Prisma7TypeMapping>> = {
  String: { constructorName: 'String', args: [] },
  Boolean: { constructorName: 'Boolean', args: [] },
  Int: { constructorName: 'Int', args: [] },
  BigInt: { constructorName: 'BigInt', args: [] },
  Float: { constructorName: 'Float', args: [] },
  Decimal: { constructorName: 'Numeric', args: ['65', '30'] },
  DateTime: { constructorName: 'Timestamp', args: ['3'] },
  Json: { constructorName: 'Jsonb', args: [] },
  Bytes: { constructorName: 'Bytes', args: [] },
};

/** `@db.X` spellings with a Prisma 8 codec. The attribute's own arguments pass through. */
const postgresNativeTypes: Readonly<Record<string, string>> = {
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
};

export function prisma7ScalarMapping(scalar: string): Prisma7TypeMapping | undefined {
  return Object.hasOwn(scalarTypes, scalar) ? scalarTypes[scalar] : undefined;
}

export function prisma7PostgresNativeTypeMapping(
  nativeType: string,
  args: readonly string[],
): Prisma7TypeMapping | undefined {
  const constructorName = Object.hasOwn(postgresNativeTypes, nativeType)
    ? postgresNativeTypes[nativeType]
    : undefined;
  return constructorName === undefined ? undefined : { constructorName, args };
}
