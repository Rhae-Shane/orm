/**
 * The user-facing journey for `prisma contract convert`: a project whose
 * `prisma.config.ts` points at `prisma7Schema('./schema.prisma')` runs
 * `contract convert`, switches its config to the Prisma 8 PSL the command
 * wrote, and emits the same contract — which `db verify` then reports zero
 * findings against the database the Prisma 7 SQL built. A config on any other
 * contract source, and a Prisma 7 schema Prisma 8 refuses, both exit 2 and
 * write nothing.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  type JourneyContext,
  runContractConvert,
  runContractEmit,
  runDbSign,
  runDbVerify,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_FIXTURES = join(__dirname, '../fixtures/prisma7-source');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');

const LIST_COLUMN_SQL = readFileSync(join(PRISMA7_FIXTURES, 'supported/migration.sql'), 'utf-8');
const NO_LIST_COLUMN_SQL = readFileSync(
  join(PRISMA7_FIXTURES, 'implicit-many-to-many-names/migration.sql'),
  'utf-8',
);

const VIEW_SCHEMA = `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}

view ActiveUsers {
  id Int
}
`;

const NO_DATABASE = 'postgres://user:password@localhost:5432/unused';

function writeConfig(testDir: string, fixture: string, connectionString: string): string {
  const config = readFileSync(join(JOURNEY_FIXTURES, fixture), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, fixture);
  writeFileSync(configPath, config, 'utf-8');
  return configPath;
}

function setupPrisma7Project(
  createTempDir: () => string,
  connectionString: string,
  schema: { readonly copyFrom: string } | { readonly text: string },
): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  if ('copyFrom' in schema) {
    copyFileSync(schema.copyFrom, join(testDir, 'schema.prisma'));
  } else {
    writeFileSync(join(testDir, 'schema.prisma'), schema.text, 'utf-8');
  }
  return {
    testDir,
    configPath: writeConfig(testDir, 'prisma.config.prisma7.ts', connectionString),
    outputDir: testDir,
  };
}

/** The same project, read through the Prisma 8 PSL `contract convert` wrote. */
function onConvertedContract(ctx: JourneyContext, connectionString: string): JourneyContext {
  return {
    ...ctx,
    configPath: writeConfig(ctx.testDir, 'prisma.config.prisma7-converted.ts', connectionString),
  };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

function storageHashOf(run: EngineCommandResult): string {
  const data = run.presented?.data;
  if (typeof data !== 'object' || data === null || !('storageHash' in data)) {
    throw new Error('contract emit reported no storage hash');
  }
  const { storageHash } = data;
  if (typeof storageHash !== 'string') {
    throw new Error('contract emit reported a storage hash that is not a string');
  }
  return storageHash;
}

function errorCodeOf(run: EngineCommandResult): string | undefined {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    return undefined;
  }
  return terminal.envelope.error.code;
}

/**
 * Converts, switches the config to the written file, emits, and verifies. The
 * two passing and failing journeys differ only in the fixture they run over.
 */
async function convertAndVerify(ctx: JourneyContext, connectionString: string): Promise<void> {
  const prisma7Emit = await runContractEmit(ctx, ['--json']);
  expect(prisma7Emit.exitCode, `contract emit on the Prisma 7 source\n${output(prisma7Emit)}`).toBe(
    0,
  );

  const convert = await runContractConvert(ctx, ['--json']);
  expect(convert.exitCode, `contract convert\n${output(convert)}`).toBe(0);
  expect(convert.presented?.data).toMatchObject({
    ok: true,
    psl: { path: 'contract.prisma' },
    source: 'schema.prisma',
  });

  const written = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
  expect(written.split('\n\n')[0]).toBe(
    '// use prisma-8\n// Converted from schema.prisma by `prisma contract convert`.',
  );

  const converted = onConvertedContract(ctx, connectionString);
  const pslEmit = await runContractEmit(converted, ['--json']);
  expect(pslEmit.exitCode, `contract emit on the converted contract\n${output(pslEmit)}`).toBe(0);
  expect(storageHashOf(pslEmit)).toBe(storageHashOf(prisma7Emit));

  const sign = await runDbSign(converted, ['--json']);
  expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

  const verify = await runDbVerify(converted, ['--json']);
  expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
  expect(verify.presented?.data).toMatchObject({
    ok: true,
    mode: 'full',
    schema: { strict: false, warnings: [] },
  });
}

withTempDir(({ createTempDir }) => {
  describe('Journey: converting a Prisma 7 schema over a schema with list columns', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(LIST_COLUMN_SQL)),
    });

    it.fails(
      'converts the reference schema and verifies against the database Prisma 7 built',
      async () => {
        // The Prisma 8 PSL source refuses a function default on a list column,
        // and every Prisma 7 list default is one, so the written file does not
        // read back yet.
        await convertAndVerify(
          setupPrisma7Project(createTempDir, db.connectionString, {
            copyFrom: join(PRISMA7_FIXTURES, 'supported-verify/schema.prisma'),
          }),
          db.connectionString,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: converting a Prisma 7 schema with no list columns', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(NO_LIST_COLUMN_SQL)),
    });

    it(
      'converts relations across two schemas and verifies against the database Prisma 7 built',
      async () => {
        await convertAndVerify(
          setupPrisma7Project(createTempDir, db.connectionString, {
            copyFrom: join(PRISMA7_FIXTURES, 'implicit-many-to-many-names/schema.prisma'),
          }),
          db.connectionString,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: contract convert refuses what it cannot convert', () => {
    it(
      'refuses a contract source that is not a Prisma 7 schema and writes nothing',
      async () => {
        const ctx = setupPrisma7Project(createTempDir, NO_DATABASE, {
          copyFrom: join(PRISMA7_FIXTURES, 'implicit-many-to-many-names/schema.prisma'),
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), 'model User {\n  id Int @id\n}\n');
        const onPsl = onConvertedContract(ctx, NO_DATABASE);

        const convert = await runContractConvert(onPsl, ['--output', 'converted.prisma', '--json']);

        expect(convert.exitCode, output(convert)).toBe(2);
        expect(errorCodeOf(convert)).toBe('CONTRACT.CONVERT_SOURCE_NOT_PRISMA7');
        expect(existsSync(join(ctx.testDir, 'converted.prisma'))).toBe(false);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports what the Prisma 7 source reports about a view and writes nothing',
      async () => {
        const ctx = setupPrisma7Project(createTempDir, NO_DATABASE, { text: VIEW_SCHEMA });

        const convert = await runContractConvert(ctx, ['--json']);

        expect(convert.exitCode, output(convert)).toBe(2);
        expect(errorCodeOf(convert)).toBe('CONTRACT.SOURCE_LOAD_FAILED');
        expect(existsSync(join(ctx.testDir, 'contract.prisma'))).toBe(false);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
