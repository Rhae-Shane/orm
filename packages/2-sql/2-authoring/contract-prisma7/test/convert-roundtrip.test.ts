import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresTarget from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(fixturesDir, name, 'expected-contract.json')))
  .sort();

/**
 * A list column is nullable in a Prisma 7 contract and not nullable in a PSL
 * one, and the printer has no spelling for a nullable list (`Tag[]?`).
 */
const listColumnCases = new Set([
  'dbgenerated-without-expression-optional',
  'defaults',
  'enum-native',
  'list-defaults',
  'native-types-accepted',
  'number-default-spellings',
  'number-defaults',
  'scalars',
]);

/**
 * The Prisma 8 PSL source resolves a relation's target by model name alone, so
 * two models sharing a name in different namespaces cannot be printed.
 */
const duplicateModelNameCases = new Set([
  'junction-name-in-other-schema',
  'relation-name-in-two-schemas',
]);

function prisma7SchemaPath(caseName: string): string {
  const directory = join(fixturesDir, caseName, 'schema');
  return existsSync(directory) ? directory : join(fixturesDir, caseName, 'schema.prisma');
}

async function loadThroughSource(
  load: (context: ContractSourceContext) => Promise<unknown> | unknown,
  schemaPath: string,
  what: string,
): Promise<Contract<SqlStorage>> {
  const result = await load(postgresSourceContext([schemaPath]));
  const outcome = result as
    | { ok: true; value: unknown }
    | { ok: false; failure: { diagnostics: unknown } };
  if (!outcome.ok) {
    throw new Error(`${what} did not load: ${JSON.stringify(outcome.failure.diagnostics)}`);
  }
  return outcome.value as Contract<SqlStorage>;
}

function serialize(contract: Contract<SqlStorage>): unknown {
  return JSON.parse(JSON.stringify(new PostgresContractSerializer().serializeContract(contract)));
}

async function roundTrip(caseName: string): Promise<void> {
  const schemaPath = prisma7SchemaPath(caseName);
  const sourceContext = postgresSourceContext([schemaPath]);
  const prisma7 = await loadThroughSource(
    (context) =>
      prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(context),
    schemaPath,
    `Prisma 7 fixture "${caseName}"`,
  );

  const ast = postgresTarget.printPslContract?.(prisma7);
  if (ast === undefined) {
    throw new Error('the Postgres target descriptor has no printPslContract hook');
  }
  const text = printPsl(ast, {
    pslBlockDescriptors: sourceContext.authoringContributions.pslBlockDescriptors,
    codecLookup: sourceContext.codecLookup,
  });

  const directory = mkdtempSync(join(tmpdir(), 'prisma7-convert-'));
  const printedPath = join(directory, 'contract.prisma');
  writeFileSync(printedPath, text);

  const printedContract = await loadThroughSource(
    (context) =>
      prismaContract(printedPath, {
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
        enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
      }).source.load(context),
    printedPath,
    `the PSL printed from "${caseName}"`,
  );

  expect(serialize(printedContract)).toEqual(serialize(prisma7));
  expect(printedContract.storage.storageHash).toBe(prisma7.storage.storageHash);
}

describe('a printed Prisma 7 contract reads back as the same contract', () => {
  for (const caseName of cases) {
    if (listColumnCases.has(caseName)) {
      it.fails(`${caseName} (a nullable list has no PSL spelling yet)`, async () => {
        await roundTrip(caseName);
      });
      continue;
    }
    if (duplicateModelNameCases.has(caseName)) {
      it.fails(`${caseName} (one model name in two namespaces has no PSL spelling)`, async () => {
        await roundTrip(caseName);
      });
      continue;
    }
    it(caseName, async () => {
      await roundTrip(caseName);
    });
  }
});
