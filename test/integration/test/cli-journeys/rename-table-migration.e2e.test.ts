/**
 * Renaming a table keeps its rows (Postgres).
 *
 * A model whose table name changes used to plan as `dropTable` plus `createTable`. With `--rename-table <from>=<to>` the operator states the rename and the plan carries a `renameTable` operation instead.
 *
 * Journey R1 (`migration plan`): create `userProfile` with rows, a unique constraint, a foreign key, an index, row-level security and a policy, then drop the model's `@@map` so it names `UserProfile`. Planning without the flag is refused by the case-change guard and a stale intent fails planning. The stated intent plans the rename plus a rename of each constraint and index named after the old table; `migrate` keeps the rows, the policy and RLS; `db verify --schema-only` is clean; a plan with no schema change is empty; and a later migration that removes the unique constraint, the foreign key and the index applies.
 *
 * Journey R2 (`migration new`): the same rename authored by hand on a table with no other objects. The flag pre-fills the scaffolded `migration.ts` with the rename call; running the file self-emits the op, and `migrate` applies it.
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
      'guard refuses the bare plan; stale intent fails; stated intent renames the table and its named objects, keeps rows and policies, and later changes apply',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await sql(db.connectionString, 'CREATE ROLE app_user');
        swapPslContract(ctx, 'contract-rename-table-objects-from');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `R1.01: emit userProfile: ${emit.stderr}`).toBe(0);
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `R1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `R1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        await sql(
          db.connectionString,
          `INSERT INTO "public"."Account" (id) VALUES (1);
           INSERT INTO "public"."userProfile" (id, email, handle, tenant_id, "accountId")
           VALUES (1, 'alice@example.com', 'alice', 1, 1), (2, 'bob@example.com', 'bob', 1, 1)`,
        );
        swapPslContract(ctx, 'contract-rename-table-objects-to');
        const emitRenamed = await runContractEmit(ctx);
        expect(emitRenamed.exitCode, `R1.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);
        const origin = latestMigrationDirName(ctx);

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
          document.operations.map((op) => op.label),
          'R1.07: the rename, then a rename of each object named after the old table',
        ).toEqual([
          'Rename table "userProfile" to "UserProfile"',
          'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
          'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
          'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
          'Rename index "userProfile_accountId_idx_cbfb3085" to "UserProfile_accountId_idx_cbfb3085" on "UserProfile"',
          'Rename index "userProfile_handle_idx_b5b249e4" to "UserProfile_handle_idx_b5b249e4" on "UserProfile"',
        ]);
        expect(
          document.operations.every((op) => op.operationClass === 'widening'),
          'R1.07: every operation is a widening rename',
        ).toBe(true);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectRowsSurvived(db.connectionString, 'R1.09');
        const live = await sql(
          db.connectionString,
          `SELECT
             (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
               WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
             (SELECT array_agg(policyname::text) FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'UserProfile') AS policies,
             (SELECT relrowsecurity FROM pg_class
               WHERE oid = '"public"."UserProfile"'::regclass) AS rls`,
        );
        expect(live.rows[0], 'R1.09: constraints renamed, policy and RLS kept').toEqual({
          constraints: ['UserProfile_accountId_fkey', 'UserProfile_email_key', 'UserProfile_pkey'],
          policies: [expect.stringMatching(/^tenant_read_[0-9a-f]{8}$/)],
          rls: true,
        });

        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `R1.10: db verify --schema-only: ${verify.stderr}`).toBe(0);

        const fresh = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(fresh.exitCode, `R1.11: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'R1.11: plan is empty').toBe(true);
        expect(getMigrationDirs(ctx), 'R1.11: nothing written').toHaveLength(2);

        swapPslContract(ctx, 'contract-rename-table-objects-dropped');
        const emitDropped = await runContractEmit(ctx);
        expect(emitDropped.exitCode, `R1.12: emit without objects: ${emitDropped.stderr}`).toBe(0);
        const dropPlan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'drop-objects',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(dropPlan.exitCode, `R1.12: plan the removal: ${dropPlan.stderr}`).toBe(0);
        const applyDrop = await runMigrate(ctx);
        expect(applyDrop.exitCode, `R1.13: migrate the removal: ${applyDrop.stderr}`).toBe(0);
        const remaining = await sql(
          db.connectionString,
          `SELECT
             (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
               WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
             (SELECT array_agg(indexname::text) FROM pg_indexes
               WHERE schemaname = 'public' AND tablename = 'UserProfile') AS indexes`,
        );
        expect(remaining.rows[0], 'R1.13: unique, foreign key and indexes removed').toEqual({
          constraints: ['UserProfile_pkey'],
          indexes: ['UserProfile_pkey'],
        });
        const verifyDropped = await runDbVerify(ctx, ['--schema-only']);
        expect(
          verifyDropped.exitCode,
          `R1.14: db verify --schema-only after the removal: ${verifyDropped.stderr}`,
        ).toBe(0);
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
