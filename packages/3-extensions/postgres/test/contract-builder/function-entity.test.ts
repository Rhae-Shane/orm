import { describe, expect, it } from 'vitest';
import { defineContract, field, model, pgFunction, sql } from '../../src/exports/contract-builder';

const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

describe('pgFunction entity authoring', () => {
  it('attaches a function entity and a column default that calls it', () => {
    const AppNanoid = pgFunction({
      name: 'AppNanoid',
      functionName: 'app_nanoid',
      signature: 'size int DEFAULT 16',
      returns: 'text',
      body: 'RETURN gen_random_uuid()::text;',
    });
    const contract = defineContract({
      entities: [AppNanoid],
      models: {
        User: model('User', {
          fields: {
            id: field.column(textColumn).default(sql`app_nanoid(16)`).id(),
          },
        }).sql({ table: 'user' }),
      },
    });
    const ns = contract.storage.namespaces['public'];
    expect(ns?.entries.function?.['app_nanoid']).toMatchObject({
      kind: 'postgres-function',
      functionName: 'app_nanoid',
      signature: 'size int DEFAULT 16',
      returns: 'text',
    });
    expect(ns?.entries.table?.['user']?.columns['id']?.default).toEqual({
      kind: 'function',
      expression: 'app_nanoid(16)',
    });
  });
});
