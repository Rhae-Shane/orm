/**
 * Renaming a table keeps its rows (Postgres).
 *
 * A model whose table name changes used to plan as `dropTable` plus
 * `createTable`. With `--rename-table <from>=<to>` the operator states the
 * rename and the plan carries one `renameTable` operation instead.
 *
 * Journey R1 (`migration plan`): create `userProfile` with rows, drop the
 * `@@map` so the model names `UserProfile`, and confirm that planning without
 * the flag is refused by the case-change guard, that a stale intent is
 * refused as a planning failure, and that the stated intent plans exactly one
 * rename, applies, keeps the rows, and verifies clean.
 *
 * Journey R2 (`migration new`): the same rename authored by hand. The flag
 * pre-fills the scaffolded `migration.ts` with the rename call; running the
 * file self-emits the op, and `migrate` applies it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getLatestMigrationDir,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationNew,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

interface PlanDocument {
  readonly operations: readonly { id: string; label: string; operationClass: string }[];
}

interface OpsJson {
  readonly id: string;
  readonly execute: readonly { sql: string }[];
}

const SEED_ROWS = `INSERT INTO "public"."userProfile" (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@example.com')`;

async function seedRenamedTable(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<string> {
  swapPslContract(ctx, 'contract-rename-table-from');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}.01: emit userProfile: ${emit.stderr}`).toBe(0);
  const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(plan.exitCode, `${label}.02: plan initial: ${plan.stderr}`).toBe(0);
  const apply = await runMigrate(ctx);
  expect(apply.exitCode, `${label}.03: migrate initial: ${apply.stderr}`).toBe(0);
  await sql(connectionString, SEED_ROWS);

  swapPslContract(ctx, 'contract-rename-table-to');
  const emitRenamed = await runContractEmit(ctx);
  expect(emitRenamed.exitCode, `${label}.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);
  return latestMigrationDirName(ctx);
}

async function expectRowsSurvived(connectionString: string, label: string): Promise<void> {
  const rows = await sql(
    connectionString,
    `SELECT id, email FROM "public"."UserProfile" ORDER BY id`,
  );
  expect(rows.rows, `${label}: rows present under the new name`).toEqual([
    { id: 1, email: 'alice@example.com' },
    { id: 2, email: 'bob@example.com' },
  ]);
  const old = await sql(connectionString, `SELECT to_regclass('"public"."userProfile"') AS old`);
  expect(old.rows[0]?.['old'], `${label}: old name is gone`).toBeNull();
}

withTempDir(({ createTempDir }) => {
  describe('Journey R1: rename a table with migration plan --rename-table', () => {
    const db = useDevDatabase();

    it(
      'guard refuses the bare plan; stale intent fails; stated intent plans one rename, keeps the rows, verifies clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const origin = await seedRenamedTable(ctx, db.connectionString, 'R1');

        const bare = await runMigrationPlan(ctx, ['--name', 'bare', '--from', origin, '--json']);
        expect(bare.exitCode, 'R1.05: bare plan is refused').not.toBe(0);
        const bareError = engineError(bare);
        expect(bareError?.code, 'R1.05: guard code').toBe('MIGRATION.PLANNING_FAILED');
        expect(bareError?.why, 'R1.05: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );
        expect(
          `${bareError?.why}\n${bareError?.summary}\n${JSON.stringify(bareError?.nextActions)}`,
          'R1.05: guard points at the flag',
        ).toContain('--rename-table');
        expect(getMigrationDirs(ctx), 'R1.05: nothing written').toHaveLength(1);

        const stale = await runMigrationPlan(ctx, [
          '--name',
          'stale',
          '--from',
          origin,
          '--rename-table',
          'userProfile=Nope',
          '--json',
        ]);
        expect(stale.exitCode, 'R1.06: stale intent is refused').not.toBe(0);
        const staleError = engineError(stale);
        expect(staleError?.code, 'R1.06: planning failure').toBe('MIGRATION.PLANNING_FAILED');
        expect(staleError?.why, 'R1.06: names the unmatched intent').toContain(
          'MIGRATION.TABLE_RENAME_UNMATCHED',
        );
        expect(getMigrationDirs(ctx), 'R1.06: nothing written').toHaveLength(1);

        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'rename-user-profile',
          '--from',
          origin,
          '--rename-table',
          'userProfile=UserProfile',
          '--json',
        ]);
        expect(plan.exitCode, `R1.07: plan with intent: ${plan.stderr}`).toBe(0);
        const document = parseJsonOutput<PlanDocument>(plan);
        expect(
          document.operations.map((op) => ({ id: op.id, operationClass: op.operationClass })),
          'R1.07: exactly one rename op',
        ).toEqual([{ id: 'renameTable.userProfile', operationClass: 'widening' }]);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectRowsSurvived(db.connectionString, 'R1.09');

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R1.10: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey R2: rename a table with migration new --rename-table', () => {
    const db = useDevDatabase();

    it(
      'the scaffold carries the rename call; self-emit renders the SQL; migrate keeps the rows',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedRenamedTable(ctx, db.connectionString, 'R2');

        const scaffold = await runMigrationNew(ctx, [
          '--name',
          'rename-user-profile',
          '--rename-table',
          'userProfile=UserProfile',
        ]);
        expect(scaffold.exitCode, `R2.05: migration new: ${scaffold.stderr}`).toBe(0);
        const latest = getLatestMigrationDir(ctx);
        expect(latest, 'R2.05: scaffold dir').toBeDefined();
        const packageDir = join(ctx.testDir, 'migrations', 'app', latest!);
        expect(readFileSync(join(packageDir, 'migration.ts'), 'utf-8'), 'R2.05: call').toMatch(
          /this\.renameTable\(\{ table: ['"]userProfile['"], to: ['"]UserProfile['"] \}\)/,
        );

        const emitted = await selfEmitMigration(ctx, ['--dir', `migrations/app/${latest}`]);
        expect(emitted.exitCode, `R2.06: self-emit: ${emitted.stderr}`).toBe(0);
        const ops = JSON.parse(readFileSync(join(packageDir, 'ops.json'), 'utf-8')) as OpsJson[];
        expect(
          ops.map((op) => op.id),
          'R2.06: one rename op',
        ).toEqual(['renameTable.userProfile']);
        expect(
          ops[0]?.execute.map((step) => step.sql),
          'R2.06: rendered SQL',
        ).toEqual(['ALTER TABLE "userProfile" RENAME TO "UserProfile"']);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R2.07: migrate: ${apply.stderr}`).toBe(0);
        await expectRowsSurvived(db.connectionString, 'R2.08');

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R2.09: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
