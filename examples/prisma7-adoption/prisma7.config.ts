import 'dotenv/config';
import { defineConfig } from '@prisma/prisma7/config';

const url = process.env['DATABASE_URL'];
if (url === undefined) {
  throw new Error('DATABASE_URL is not set. Run `pnpm db:start` in another terminal first.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: { url },
});
