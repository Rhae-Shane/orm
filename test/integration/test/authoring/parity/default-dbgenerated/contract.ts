import { textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, genRandomUuid, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(textColumn).default(genRandomUuid()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
