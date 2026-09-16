import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import {
  autoincrement,
  defineContract,
  field,
  genRandomUuid,
  model,
  now,
  sql,
} from '../../src/exports/contract-builder';

describe('postgres contract builder default helpers', () => {
  it('genRandomUuid() is the storage default PSL writes as @default(gen_random_uuid())', () => {
    expect(genRandomUuid()).toEqual({ kind: 'function', expression: 'gen_random_uuid()' });
  });

  it('re-exports the family helpers beside it', () => {
    expect(now()).toEqual({ kind: 'function', expression: 'now()' });
    expect(autoincrement()).toEqual({ kind: 'function', expression: 'autoincrement()' });
    expect(sql`'{}'::jsonb`).toEqual({ kind: 'function', expression: "'{}'::jsonb" });
  });

  it('lowers genRandomUuid() through defineContract', () => {
    const contract = defineContract({
      models: {
        T: model('T', { fields: { id: field.column(textColumn).default(genRandomUuid()).id() } }),
      },
    });
    expect(
      contract.storage.namespaces['public']?.entries.table?.['T']?.columns['id']?.default,
    ).toEqual({ kind: 'function', expression: 'gen_random_uuid()' });
  });
});
