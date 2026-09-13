import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Schema } from '../src/provider';
import { postgresPrisma7Options, postgresSourceContext } from './support';

const fixturesDir = join(dirname(new URL(import.meta.url).pathname), 'fixtures');
const update = process.env['UPDATE_PRISMA7_FIXTURES'] === '1';

interface ExpectedDiagnostic {
  readonly code: string;
  readonly line: number | undefined;
  readonly message: string;
}

function expectedPath(caseName: string, file: string): string {
  return join(fixturesDir, caseName, file);
}

function compareOrWrite(path: string, actual: unknown): void {
  const rendered = `${JSON.stringify(actual, null, 2)}\n`;
  if (update || !existsSync(path)) {
    writeFileSync(path, rendered);
    return;
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(actual);
}

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('Prisma 7 fixtures', () => {
  it('has a case per rule row', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const caseName of cases) {
    it(caseName, async () => {
      const schemaPath = join(fixturesDir, caseName, 'schema.prisma');
      const config = prisma7Schema(schemaPath, postgresPrisma7Options);
      const result = await config.source.load(postgresSourceContext([schemaPath]));
      const diagnosticsPath = expectedPath(caseName, 'expected-diagnostics.json');
      const contractPath = expectedPath(caseName, 'expected-contract.json');

      if (result.ok) {
        expect(existsSync(diagnosticsPath)).toBe(false);
        const serializer = new PostgresContractSerializer();
        const serialized: unknown = JSON.parse(
          JSON.stringify(serializer.serializeContract(result.value as Contract<SqlStorage>)),
        );
        // The full SQL validator with the Postgres entity kinds registered, as
        // `contract emit` and `db verify` run it.
        expect(() => serializer.deserializeContract(serialized)).not.toThrow();
        compareOrWrite(contractPath, serialized);
        return;
      }

      expect(existsSync(contractPath)).toBe(false);
      const diagnostics: ExpectedDiagnostic[] = result.failure.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        line: diagnostic.span?.start.line,
        message: diagnostic.message,
      }));
      expect(diagnostics.length).toBeGreaterThan(0);
      compareOrWrite(diagnosticsPath, diagnostics);
    });
  }
});
