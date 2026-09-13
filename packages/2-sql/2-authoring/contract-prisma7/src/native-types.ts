/**
 * The mechanism that turns a Prisma 7 scalar or `@db.*` spelling into the
 * Prisma 8 type constructor call that produces the same column. The table
 * itself is target knowledge: the Postgres one lives in
 * `@internal/target-postgres/prisma7-type-map` and the facade passes it in.
 */
export interface Prisma7TypeMapping {
  readonly constructorName: string;
  readonly args: readonly string[];
}

export interface Prisma7TypeMap {
  /** Prisma 7 scalar name to the constructor Prisma 7 uses for it by default. */
  readonly scalars: Readonly<Record<string, Prisma7TypeMapping>>;
  /** `@db.X` spelling to the constructor name; the attribute's own arguments pass through. */
  readonly nativeTypes: Readonly<Record<string, string>>;
}

export function prisma7ScalarMapping(
  typeMap: Prisma7TypeMap,
  scalar: string,
): Prisma7TypeMapping | undefined {
  return Object.hasOwn(typeMap.scalars, scalar) ? typeMap.scalars[scalar] : undefined;
}

export function prisma7NativeTypeMapping(
  typeMap: Prisma7TypeMap,
  nativeType: string,
  args: readonly string[],
): Prisma7TypeMapping | undefined {
  const constructorName = Object.hasOwn(typeMap.nativeTypes, nativeType)
    ? typeMap.nativeTypes[nativeType]
    : undefined;
  return constructorName === undefined ? undefined : { constructorName, args };
}
