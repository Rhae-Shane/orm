import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Schema as sqlPrisma7Schema } from '@internal/sql-contract-prisma7/provider';
import { INSTANT_NOW_GENERATOR_ID } from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresTypeMap } from '@internal/target-postgres/prisma7-type-map';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';

export interface Prisma7SchemaOptions {
  /** Path of the emitted `contract.json`. Defaults to `contract.json` next to the schema. */
  readonly output?: string;
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string, options?: Prisma7SchemaOptions): ContractConfig {
  return sqlPrisma7Schema(schemaPath, {
    ...ifDefined('output', options?.output),
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
    typeMap: prisma7PostgresTypeMap,
    updatedAt: { generatorId: INSTANT_NOW_GENERATOR_ID },
  });
}
