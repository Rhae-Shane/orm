/**
 * Journey: every literal `@default` is read by the column codec's `decodePsl`,
 * stored in the contract in the codec's JSON form, created in the database by
 * `db init`, verified clean by strict `db verify`, and read back through the
 * client as the codec's own value type.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Contract } from '@prisma/orm-postgres/contract/types';
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types';
import postgres from '@prisma/orm-postgres/runtime';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const SCHEMA = `// use prisma-8

model T {
  id     Int     @id @default(autoincrement())
  meta   Jsonb   @default("{}")
  items  Json    @default("[1, 2]")
  big    BigInt  @default(9007199254740993)
  price  Decimal @default(1.50)
  ratio  Float   @default("NaN")
  name   String  @default("x")
  flag   Boolean @default(true)
  scores Int[]   @default([1, 2])
}
`;

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly unknown[] };
}

interface EmittedColumn {
  readonly default?: { readonly kind: string; readonly value: unknown };
}

interface EmittedTable {
  readonly name?: string;
  readonly columns: Record<string, EmittedColumn>;
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

function readContractJson(ctx: JourneyContext): unknown {
  return JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
}

/** The one table the schema declares, under whichever key the interpreter stores it. */
function emittedTable(contractJson: unknown): {
  readonly key: string;
  readonly table: EmittedTable;
} {
  const tables = (
    contractJson as {
      storage: { namespaces: { public: { entries: { table: Record<string, EmittedTable> } } } };
    }
  ).storage.namespaces.public.entries.table;
  const [entry, ...rest] = Object.entries(tables);
  if (entry === undefined || rest.length > 0)
    throw new Error(`expected one table, got ${Object.keys(tables)}`);
  return { key: entry[0], table: entry[1] };
}

async function rows(result: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const row of result) out.push(row);
  return out;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: codec-owned PSL literal defaults', () => {
    const db = useDevDatabase();

    it(
      'emits, initialises, verifies clean, and reads the defaults back with their decoded types',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const contractJson = readContractJson(ctx);
        const { key, table } = emittedTable(contractJson);
        const columns = table.columns;
        expect({
          meta: columns['meta']?.default,
          items: columns['items']?.default,
          big: columns['big']?.default,
          price: columns['price']?.default,
          ratio: columns['ratio']?.default,
          name: columns['name']?.default,
          flag: columns['flag']?.default,
          scores: columns['scores']?.default,
        }).toEqual({
          meta: { kind: 'literal', value: {} },
          items: { kind: 'literal', value: [1, 2] },
          big: { kind: 'literal', value: '9007199254740993' },
          price: { kind: 'literal', value: '1.50' },
          ratio: { kind: 'literal', value: 'NaN' },
          name: { kind: 'literal', value: 'x' },
          flag: { kind: 'literal', value: true },
          scores: { kind: 'literal', value: [1, 2] },
        });

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
        expect(
          parseJsonOutput<SchemaVerifyResult>(verify).schema.issues,
          `db verify\n${output(verify)}`,
        ).toEqual([]);

        const tables = await withClient(db.connectionString, async (client) => {
          const result = await client.query<{ table_name: string }>(
            "select table_name from information_schema.tables where table_schema = 'public'",
          );
          return result.rows.map((row) => row.table_name);
        });
        expect(tables, 'db init created the table under the contract key').toContain(key);
        await withClient(db.connectionString, (client) =>
          client.query(`insert into "${key}" default values`),
        );

        const client = postgres<Contract<SqlStorage>>({ contractJson, url: db.connectionString });
        const runtime = await client.connect();
        try {
          const sqlNamespace = (
            client.sql as unknown as {
              readonly public: Record<string, { select(...columns: string[]): { build(): never } }>;
            }
          ).public;
          const sqlTable = sqlNamespace[key];
          expect(
            sqlTable,
            `the client exposes ${key}; it has ${Object.keys(sqlNamespace)}`,
          ).toBeDefined();
          const plan = sqlTable
            ?.select('id', 'meta', 'items', 'big', 'price', 'ratio', 'name', 'flag', 'scores')
            .build();
          expect(await rows(runtime.query(plan as never))).toEqual([
            {
              id: 1,
              meta: {},
              items: [1, 2],
              big: 9007199254740993n,
              price: '1.50',
              ratio: Number.NaN,
              name: 'x',
              flag: true,
              scores: [1, 2],
            },
          ]);
        } finally {
          await runtime.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
