import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresTypeMap } from '@internal/target-postgres/prisma7-type-map';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import type { Prisma7SchemaOptions } from '../src/provider';

/** The same composition `prisma contract emit` builds for a Postgres config. */
export function postgresSourceContext(resolvedInputs: readonly string[]): ContractSourceContext {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

/** What `@prisma/orm-postgres/config`'s `prisma7Schema` passes to the SQL provider. */
export const postgresPrisma7Options: Prisma7SchemaOptions = {
  target: postgresPackRef,
  createNamespace: postgresCreateNamespace,
  nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
  typeMap: prisma7PostgresTypeMap,
};
