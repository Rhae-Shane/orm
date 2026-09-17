import { textColumn, timestamptzTemporalColumn } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  genRandomUuid,
  model,
  sql,
} from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    T: model('T', {
      fields: {
        id: field.column(textColumn).default(sql`gen_random_uuid()`).id(),
        expires: field
          .column(timestamptzTemporalColumn)
          .default(sql`(now() + '00:03:00'::interval)`),
        createdAt: field.column(timestamptzTemporalColumn).default(sql`now()`),
        tags: field.column(textColumn).many().default(sql`'{}'::text[]`),
        ident: field.column(textColumn).default(genRandomUuid()),
        escaped: field.column(textColumn).default(sql`E'\n'`),
      },
    }).sql({ table: 't' }),
  },
});
