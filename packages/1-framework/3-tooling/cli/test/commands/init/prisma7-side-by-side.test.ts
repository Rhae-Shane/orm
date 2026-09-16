import { describe, expect, it } from 'vitest';
import { rewritePrismaBinary } from '../../../src/commands/init/prisma7-side-by-side';

const NODE_PACKAGE_RUNNER = 'np' + 'x';

describe('rewritePrismaBinary', () => {
  it.each([
    ['at the start', 'prisma migrate dev', 'prisma7 migrate dev'],
    ['after &&', 'tsc && prisma generate', 'tsc && prisma7 generate'],
    ['after && with no spaces', 'tsc&&prisma generate', 'tsc&&prisma7 generate'],
    ['after ||', 'true || prisma generate', 'true || prisma7 generate'],
    ['after ;', 'echo x; prisma studio', 'echo x; prisma7 studio'],
    ['after |', 'cat x | prisma format', 'cat x | prisma7 format'],
    ['after pnpm', 'pnpm prisma generate', 'pnpm prisma7 generate'],
    ['after pnpm exec', 'pnpm exec prisma generate', 'pnpm exec prisma7 generate'],
    ['after pnpm dlx', 'pnpm dlx prisma generate', 'pnpm dlx prisma7 generate'],
    [
      'after the Node package runner',
      `${NODE_PACKAGE_RUNNER} prisma migrate deploy`,
      `${NODE_PACKAGE_RUNNER} prisma7 migrate deploy`,
    ],
    ['after yarn', 'yarn prisma generate', 'yarn prisma7 generate'],
    ['after yarn exec', 'yarn exec prisma generate', 'yarn exec prisma7 generate'],
    ['after yarn dlx', 'yarn dlx prisma generate', 'yarn dlx prisma7 generate'],
    ['after bun', 'bun prisma generate', 'bun prisma7 generate'],
    ['after bun x', 'bun x prisma generate', 'bun x prisma7 generate'],
    ['after bunx', 'bunx prisma generate', 'bunx prisma7 generate'],
    [
      'after dotenv and its --',
      'dotenv -e .env -- prisma migrate dev',
      'dotenv -e .env -- prisma7 migrate dev',
    ],
    [
      'after dotenvx run and its --',
      'dotenvx run -f .env -- prisma migrate dev',
      'dotenvx run -f .env -- prisma7 migrate dev',
    ],
    [
      'after env-cmd and its --',
      'env-cmd -f .env -- prisma migrate dev',
      'env-cmd -f .env -- prisma7 migrate dev',
    ],
    [
      'after cross-env and its assignments',
      'cross-env NODE_ENV=test prisma migrate dev',
      'cross-env NODE_ENV=test prisma7 migrate dev',
    ],
    [
      'after a runner behind a passthrough wrapper',
      'dotenv -e .env -- pnpm prisma migrate dev',
      'dotenv -e .env -- pnpm prisma7 migrate dev',
    ],
    [
      'after an environment assignment',
      'NODE_OPTIONS=--max-old-space-size=4096 prisma studio',
      'NODE_OPTIONS=--max-old-space-size=4096 prisma7 studio',
    ],
    [
      'after several environment assignments',
      'A=1 B=two prisma generate',
      'A=1 B=two prisma7 generate',
    ],
    [
      'twice in one script',
      'prisma generate && prisma migrate dev',
      'prisma7 generate && prisma7 migrate dev',
    ],
  ])('rewrites the prisma binary %s', (_case, script, rewritten) => {
    expect(rewritePrismaBinary(script)).toBe(rewritten);
  });

  it.each([
    ['a script that does not invoke prisma', 'biome check .'],
    ['a prisma-prefixed binary', 'prisma-erd generate'],
    ['a prisma-prefixed binary with no arguments', 'prisma-erd-generator'],
    ['a prisma package spec', `${NODE_PACKAGE_RUNNER} prisma@7 generate`],
    ['a prisma package spec at the start', 'prisma@7 generate'],
    ['a path argument named prisma', 'tsx scripts/seed.ts prisma'],
    [
      'a runner that is an argument, not the command',
      `echo ${NODE_PACKAGE_RUNNER} prisma generate`,
    ],
    ['prisma after the -- of a command that is not a wrapper', 'vitest -- prisma'],
  ])('leaves %s alone', (_case, script) => {
    expect(rewritePrismaBinary(script)).toBe(script);
  });
});
