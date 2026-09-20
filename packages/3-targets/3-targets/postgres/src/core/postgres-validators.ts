import { type } from 'arktype';

export const PostgresRoleSchema = type({
  kind: "'role'",
  name: 'string',
  namespaceId: 'string',
  'control?': "'external'",
});

export const PostgresRlsPolicySchema = type({
  kind: "'policy'",
  name: 'string',
  'prefix?': 'string',
  tableName: 'string',
  namespaceId: 'string',
  operation: "'select' | 'insert' | 'update' | 'delete' | 'all'",
  roles: type.string.array().readonly(),
  'using?': 'string',
  'withCheck?': 'string',
  permissive: 'boolean',
});

export const PostgresRlsEnablementSchema = type({
  kind: "'rls'",
  tableName: 'string',
  namespaceId: 'string',
});

export const PostgresNativeEnumSchema = type({
  kind: "'postgres-enum'",
  typeName: 'string',
  members: type.string.array().readonly(),
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});

export const PostgresFunctionSchema = type({
  kind: "'postgres-function'",
  functionName: 'string',
  signature: 'string',
  returns: 'string',
  body: 'string',
  'language?': 'string',
  'volatility?': "'VOLATILE' | 'STABLE' | 'IMMUTABLE'",
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});
