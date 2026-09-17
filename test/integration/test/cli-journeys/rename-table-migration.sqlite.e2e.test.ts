/**
 * Renaming a table keeps its rows (SQLite).
 *
 * The SQLite twin of `rename-table-migration.e2e.test.ts`: a file database
 * driven through the `@internal/sqlite/config` facade config. Create
 * `userProfile` with rows, drop the `@@map` so the model names
 * `UserProfile`, and confirm that `migration plan --rename-table` plans
 * exactly one rename, applies, keeps the rows, and verifies clean.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  timeouts,
} from '../utils/journey-test-helpers';

const FROM_PSL = `// use prisma-8

model UserProfile {
  id    Int    @id
  email String

  @@map("userProfile")
}
`;

const TO_PSL = `// use prisma-8

model UserProfile {
  id    Int    @id
  email String
}
`;

interface PlanDocument {
  readonly operations: readonly { id: string; label: string; operationClass: string }[];
}

function sqliteConfig(dbPath: string): string {
  return `import { defineConfig as ormConfig } from '@internal/sqlite/config';
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    db: { connection: ${JSON.stringify(dbPath)} },
    migrations: { dir: 'migrations' },
  }),
});
`;
}

function setupSqliteJourney(createTempDir: () => string): JourneyContext & { dbPath: string } {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, sqliteConfig(dbPath), 'utf-8');
  writeFileSync(join(testDir, 'contract.prisma'), FROM_PSL, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function withDatabase<T>(dbPath: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

withTempDir(({ createTempDir }) => {
  describe('Journey R3 (SQLite): rename a table with migration plan --rename-table', () => {
    it(
      'stale intent fails; stated intent plans one rename, keeps the rows, verifies clean',
      async () => {
        const ctx = setupSqliteJourney(createTempDir);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `R3.01: emit userProfile: ${emit.stderr}`).toBe(0);
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `R3.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `R3.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        const origin = latestMigrationDirName(ctx);
        withDatabase(ctx.dbPath, (db) => {
          db.exec(
            `INSERT INTO "userProfile" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@example.com')`,
          );
        });

        writeFileSync(join(ctx.testDir, 'contract.prisma'), TO_PSL, 'utf-8');
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `R3.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);

        const bare = await runMigrationPlan(ctx, ['--name', 'bare', '--from', origin, '--json']);
        expect(bare.exitCode, 'R3.05: bare plan is refused by the guard').not.toBe(0);
        expect(engineError(bare)?.why, 'R3.05: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );

        const stale = await runMigrationPlan(ctx, [
          '--name',
          'stale',
          '--from',
          origin,
          '--rename-table',
          'userProfile=Nope',
          '--json',
        ]);
        expect(stale.exitCode, 'R3.06: stale intent is refused').not.toBe(0);
        expect(engineError(stale)?.why, 'R3.06: names the unmatched intent').toContain(
          'MIGRATION.TABLE_RENAME_UNMATCHED',
        );
        expect(getMigrationDirs(ctx), 'R3.06: nothing written').toHaveLength(1);

        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'rename-user-profile',
          '--from',
          origin,
          '--rename-table',
          'userProfile=UserProfile',
          '--json',
        ]);
        expect(plan.exitCode, `R3.07: plan with intent: ${plan.stderr}`).toBe(0);
        const document = parseJsonOutput<PlanDocument>(plan);
        expect(
          document.operations.map((op) => ({ id: op.id, operationClass: op.operationClass })),
          'R3.07: exactly one rename op',
        ).toEqual([{ id: 'renameTable.userProfile', operationClass: 'widening' }]);
        const opsJson = readFileSync(
          join(ctx.testDir, 'migrations', 'app', getMigrationDirs(ctx).at(-1)!, 'ops.json'),
          'utf-8',
        );
        expect(opsJson, 'R3.07: rendered SQL').toContain(
          'ALTER TABLE \\"userProfile\\" RENAME TO \\"UserProfile\\"',
        );

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R3.08: migrate: ${apply.stderr}`).toBe(0);
        const state = withDatabase(ctx.dbPath, (db) => ({
          rows: db.prepare(`SELECT id, email FROM "UserProfile" ORDER BY id`).all(),
          tables: db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%serProfile'`,
            )
            .all()
            .map((row) => row.name),
        }));
        expect(state.rows, 'R3.09: rows present under the new name').toEqual([
          { id: 1, email: 'alice@example.com' },
          { id: 2, email: 'bob@example.com' },
        ]);
        expect(state.tables, 'R3.09: old name is gone').toEqual(['UserProfile']);

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R3.10: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
