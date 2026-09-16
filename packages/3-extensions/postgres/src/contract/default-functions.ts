import type { ColumnDefault } from '@internal/contract/types';

/** PostgreSQL's `gen_random_uuid()`, the same default PSL writes as `@default(gen_random_uuid())`. */
export function genRandomUuid(): ColumnDefault {
  return { kind: 'function', expression: 'gen_random_uuid()' };
}
