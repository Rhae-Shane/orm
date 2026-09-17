/**
 * `migration new --rename-table` hands the target planner the stated renames together with the contract the migration starts from and the one it ends at, so the planner can scaffold the same rename operations `migration plan` would plan.
 */

import { createTestCli } from '@prisma/cli-engine/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import {
  contractJson,
  createOfflineProject,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;
const INTENT = { from: { name: 'userProfile' }, to: { name: 'UserProfile' } };

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

async function scaffoldContext(
  project: OfflineProject,
  args: readonly string[],
): Promise<Record<string, unknown> | undefined> {
  let received: unknown;
  const run = await createTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    config: {
      orm: offlineConfig({
        project,
        script: {
          onEmptyMigration: (context) => {
            received = context;
          },
        },
      }),
    },
  }).run(['migration', 'new', '--json', ...args], { cwd: project.dir });
  expect(run.exitCode).toBe(0);
  return typeof received === 'object' && received !== null ? { ...received } : undefined;
}

describe('migration new --rename-table', () => {
  it('passes the renames with the previous and the next contract', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });

    const context = await scaffoldContext(project, ['--rename-table', 'userProfile=UserProfile']);

    expect(context?.['renames']).toMatchObject({
      intents: [INTENT],
      fromContract: contractJson(HASH_FROM),
      toContract: contractJson(HASH_TO),
      frameworkComponents: expect.any(Array),
    });
  });

  it('passes no previous contract when the project has no migration history', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const context = await scaffoldContext(project, ['--rename-table', 'userProfile=UserProfile']);

    expect(context?.['renames']).toMatchObject({
      intents: [INTENT],
      fromContract: null,
      toContract: contractJson(HASH_TO),
    });
  });

  it('passes no renames when the flag is absent', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const context = await scaffoldContext(project, []);

    expect(context).not.toHaveProperty('renames');
  });
});
