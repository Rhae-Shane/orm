import type { EntityCoordinate } from '@internal/framework-components/ir';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { PostgresFunctionSchemaNode } from './postgres-function-schema-node';
import { PostgresNativeEnumSchemaNode } from './postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from './postgres-table-schema-node';
import { postgresNodeEntityKind } from './schema-node-kinds';

/**
 * The storage-`entries` coordinate `(entityKind, entityName)` a Postgres diff
 * node addresses — a table by its name, a native enum by its physical type
 * name, a function by its physical function name (overloads unsupported in
 * MVP). `undefined` for a node that is not a whole storage entity (a namespace,
 * a column, a policy). Lets ownership/subject resolution treat every entity kind
 * uniformly, the node self-describing its storage identity.
 */
export function postgresNodeStorageCoordinate(
  node: SqlSchemaIRNode,
): Pick<EntityCoordinate, 'entityKind' | 'entityName'> | undefined {
  if (PostgresTableSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.name };
  }
  if (PostgresNativeEnumSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.typeName };
  }
  if (PostgresFunctionSchemaNode.is(node)) {
    const entityKind = postgresNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.functionName };
  }
  return undefined;
}
