import { defineConfig } from '@prisma/cli-engine';
import { defineConfig as postgres, prisma7Schema } from '@prisma/orm-postgres/config';

export default defineConfig({
  orm: postgres({
    contract: prisma7Schema('./schema.prisma'),
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
