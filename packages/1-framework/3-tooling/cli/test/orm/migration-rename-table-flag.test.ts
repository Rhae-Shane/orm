/**
 * `--rename-table` is parsed once, the same way, on `migration plan` and
 * `migration new`, and the parsed intents reach each command's control
 * operation. The operations themselves are doubles here; what they do with the
 * intents is covered by the planner tests and the journeys.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { ok } from '@internal/utils/result';
import type { StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const mocks = vi.hoisted(() => ({
  executeMigrationPlanCommand: vi.fn(),
  executeMigrationNewCommand: vi.fn(),
}));

vi.mock('../../src/control-api/operations/migration-plan', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/control-api/operations/migration-plan')>();
  return { ...actual, executeMigrationPlanCommand: mocks.executeMigrationPlanCommand };
});

vi.mock('../../src/control-api/operations/migration-new', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/control-api/operations/migration-new')>();
  return { ...actual, executeMigrationNewCommand: mocks.executeMigrationNewCommand };
});

const { BIN_GROUPS, createBinCommands } = await import('../../src/orm/cli');

const commands = createBinCommands(() => ({}) as unknown as ControlClient);

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };
const TO_HASH = 'b'.repeat(64);

let projectDir: string;
const projectDirs: string[] = [];

afterAll(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-migration-rename-table');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: TO_HASH } }),
  );
  mocks.executeMigrationPlanCommand.mockReset().mockResolvedValue(
    ok({
      ok: true,
      noOp: true,
      from: null,
      to: TO_HASH,
      operations: [],
      emittedExtensionDirs: [],
      summary: 'No changes detected between contracts',
      timings: { total: 1 },
    }),
  );
  mocks.executeMigrationNewCommand.mockReset().mockResolvedValue(
    ok({
      ok: true,
      dir: 'migrations/app/20260101T0000_x',
      from: null,
      to: TO_HASH,
      summary: 'Scaffolded migration at migrations/app/20260101T0000_x',
    }),
  );
});

function ormConfig(): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(projectDir, 'contract.json'),
    },
  };
}

function harness() {
  return createTestCli({ commands, groups: BIN_GROUPS, config: { orm: ormConfig() } });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

const EXPECTED_RENAMES = [
  { from: { name: 'userProfile' }, to: { name: 'UserProfile' } },
  { from: { namespaceId: 'auth', name: 'orderLine' }, to: { name: 'OrderLine' } },
];

describe('migration plan --rename-table', () => {
  it('passes every parsed intent to the plan operation', async () => {
    const run = await harness().run(
      [
        'migration',
        'plan',
        '--json',
        '--rename-table',
        'userProfile=UserProfile',
        '--rename-table',
        'auth.orderLine=OrderLine',
      ],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(0);
    expect(mocks.executeMigrationPlanCommand).toHaveBeenCalledTimes(1);
    expect(mocks.executeMigrationPlanCommand.mock.calls[0]?.[0]).toMatchObject({
      renames: EXPECTED_RENAMES,
    });
  });

  it('passes no intents when the flag is absent', async () => {
    const run = await harness().run(['migration', 'plan', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(0);
    expect(mocks.executeMigrationPlanCommand.mock.calls[0]?.[0]).not.toHaveProperty('renames');
  });

  it('rejects a malformed value before the operation runs', async () => {
    const run = await harness().run(
      ['migration', 'plan', '--json', '--rename-table', 'userProfile'],
      { cwd: projectDir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CLI.INVALID_RENAME_TABLE_FLAG' },
    });
    expect(mocks.executeMigrationPlanCommand).not.toHaveBeenCalled();
  });
});

describe('migration new --rename-table', () => {
  it('passes every parsed intent to the scaffold operation', async () => {
    const run = await harness().run(
      [
        'migration',
        'new',
        '--json',
        '--rename-table',
        'userProfile=UserProfile',
        '--rename-table',
        'auth.orderLine=OrderLine',
      ],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(0);
    expect(mocks.executeMigrationNewCommand).toHaveBeenCalledTimes(1);
    expect(mocks.executeMigrationNewCommand.mock.calls[0]?.[0]).toMatchObject({
      renames: EXPECTED_RENAMES,
    });
  });

  it('rejects a malformed value before the operation runs', async () => {
    const run = await harness().run(['migration', 'new', '--json', '--rename-table', 'a=b=c'], {
      cwd: projectDir,
    });

    expect(run.exitCode).not.toBe(0);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CLI.INVALID_RENAME_TABLE_FLAG' },
    });
    expect(mocks.executeMigrationNewCommand).not.toHaveBeenCalled();
  });
});
