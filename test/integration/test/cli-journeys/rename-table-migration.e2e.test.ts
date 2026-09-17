/**
 * Renaming a table keeps its rows (Postgres).
 *
 * A model whose table name changes used to plan as `dropTable` plus `createTable`. With `--rename <from>=<to>` the operator states the rename and the migration carries a `renameTable` operation instead, plus a rename of each constraint and index named after the old table.
 *
 * Both journeys create `userProfile` with rows, a unique constraint, a foreign key, an index, row-level security and a policy, then drop the model's `@@map` so it names `UserProfile`. After `migrate`, the rows, the policy and RLS are kept, every constraint and index carries the new table name, `db verify --schema-only` is clean, a plan with no schema change is empty, and a later migration that removes the unique constraint, the foreign key and the index applies.
 *
 * Journey R1 (`migration plan`) also shows that planning without the flag is refused by the case-change guard and that a stale intent fails planning.
 *
 * Journey R2 (`migration new`) authors the rename by hand: the flag pre-fills the scaffolded `migration.ts` with the same operations `migration plan` would plan.
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

const RENAME_LABELS = [
  'Rename table "userProfile" to "UserProfile"',
  'Rename primary key "userProfile_pkey" to "UserProfile_pkey" on "UserProfile"',
  'Rename unique constraint "userProfile_email_key" to "UserProfile_email_key" on "UserProfile"',
  'Rename foreign key "userProfile_accountId_fkey" to "UserProfile_accountId_fkey" on "UserProfile"',
  'Rename index "userProfile_accountId_idx_cbfb3085" to "UserProfile_accountId_idx_cbfb3085" on "UserProfile"',
  'Rename index "userProfile_handle_idx_b5b249e4" to "UserProfile_handle_idx_b5b249e4" on "UserProfile"',
];

async function seedTableWithObjects(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<string> {
  await sql(connectionString, 'CREATE ROLE app_user');
  swapPslContract(ctx, 'contract-rename-table-objects-from');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}.01: emit userProfile: ${emit.stderr}`).toBe(0);
  const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
  expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
  const applyInitial = await runMigrate(ctx);
  expect(applyInitial.exitCode, `${label}.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
  await sql(
    connectionString,
    `INSERT INTO "public"."Account" (id) VALUES (1);
     INSERT INTO "public"."userProfile" (id, email, handle, tenant_id, "accountId")
     VALUES (1, 'alice@example.com', 'alice', 1, 1), (2, 'bob@example.com', 'bob', 1, 1)`,
  );
  swapPslContract(ctx, 'contract-rename-table-objects-to');
  const emitRenamed = await runContractEmit(ctx);
  expect(emitRenamed.exitCode, `${label}.04: emit UserProfile: ${emitRenamed.stderr}`).toBe(0);
  return latestMigrationDirName(ctx);
}

async function expectRenameApplied(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(
    connectionString,
    `SELECT id, email FROM "public"."UserProfile" ORDER BY id`,
  );
  expect(rows.rows, `${label}: rows present under the new name`).toEqual([
    { id: 1, email: 'alice@example.com' },
    { id: 2, email: 'bob@example.com' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."userProfile"') AS old,
       (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS indexes,
       (SELECT array_agg(policyname::text) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS policies,
       (SELECT relrowsecurity FROM pg_class
         WHERE oid = '"public"."UserProfile"'::regclass) AS rls`,
  );
  expect(live.rows[0], `${label}: old name gone, objects renamed, policy and RLS kept`).toEqual({
    old: null,
    constraints: ['UserProfile_accountId_fkey', 'UserProfile_email_key', 'UserProfile_pkey'],
    indexes: [
      'UserProfile_accountId_idx_cbfb3085',
      'UserProfile_email_key',
      'UserProfile_handle_idx_b5b249e4',
      'UserProfile_pkey',
    ],
    policies: ['tenant_read_f8d5e783'],
    rls: true,
  });

  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

async function expectLaterChangesApply(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const migrationCount = getMigrationDirs(ctx).length;
  const fresh = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx), '--json']);
  expect(fresh.exitCode, `${label}.01: plan with no schema change: ${fresh.stderr}`).toBe(0);
  expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}.01: plan is empty`).toBe(true);
  expect(getMigrationDirs(ctx), `${label}.01: nothing written`).toHaveLength(migrationCount);

  swapPslContract(ctx, 'contract-rename-table-objects-dropped');
  const emitDropped = await runContractEmit(ctx);
  expect(emitDropped.exitCode, `${label}.02: emit without objects: ${emitDropped.stderr}`).toBe(0);
  const dropPlan = await planMigrationAndSelfEmit(ctx, [
    '--name',
    'drop-objects',
    '--from',
    latestMigrationDirName(ctx),
    '--json',
  ]);
  expect(dropPlan.exitCode, `${label}.02: plan the removal: ${dropPlan.stderr}`).toBe(0);
  const applyDrop = await runMigrate(ctx);
  expect(applyDrop.exitCode, `${label}.03: migrate the removal: ${applyDrop.stderr}`).toBe(0);
  const remaining = await sql(
    connectionString,
    `SELECT
       (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."UserProfile"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'UserProfile') AS indexes`,
  );
  expect(remaining.rows[0], `${label}.03: unique, foreign key and indexes removed`).toEqual({
    constraints: ['UserProfile_pkey'],
    indexes: ['UserProfile_pkey'],
  });
  const verifyDropped = await runDbVerify(ctx, ['--schema-only']);
  expect(
    verifyDropped.exitCode,
    `${label}.04: db verify --schema-only after the removal: ${verifyDropped.stderr}`,
  ).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey R1: rename a table with migration plan --rename', () => {
    const db = useDevDatabase();

    it(
      'guard refuses the bare plan; stale intent fails; stated intent renames the table and its named objects, keeps rows and policies, and later changes apply',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        const origin = await seedTableWithObjects(ctx, db.connectionString, 'R1');

        const bare = await runMigrationPlan(ctx, ['--name', 'bare', '--from', origin, '--json']);
        expect(bare.exitCode, 'R1.05: bare plan is refused').not.toBe(0);
        const bareError = engineError(bare);
        expect(bareError?.code, 'R1.05: guard code').toBe('MIGRATION.PLANNING_FAILED');
        expect(bareError?.why, 'R1.05: guard names the case change').toContain(
          'MIGRATION.TABLE_NAME_CASE_CHANGED',
        );
        expect(
          bareError?.nextActions?.map((action) => action.label).join('\n'),
          'R1.05: guard points at the flag',
        ).toContain('prisma migration plan --rename "userProfile=UserProfile"');
        expect(getMigrationDirs(ctx), 'R1.05: nothing written').toHaveLength(1);

        const stale = await runMigrationPlan(ctx, [
          '--name',
          'stale',
          '--from',
          origin,
          '--rename',
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
          '--rename',
          'userProfile=UserProfile',
          '--json',
        ]);
        expect(plan.exitCode, `R1.07: plan with intent: ${plan.stderr}`).toBe(0);
        const document = parseJsonOutput<PlanDocument>(plan);
        expect(
          document.operations.map((op) => op.label),
          'R1.07: the rename, then a rename of each object named after the old table',
        ).toEqual(RENAME_LABELS);
        expect(
          document.operations.every((op) => op.operationClass === 'widening'),
          'R1.07: every operation is a widening rename',
        ).toBe(true);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R1.08: migrate: ${apply.stderr}`).toBe(0);
        await expectRenameApplied(ctx, db.connectionString, 'R1.09');
        await expectLaterChangesApply(ctx, db.connectionString, 'R1.10');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey R2: rename a table with migration new --rename', () => {
    const db = useDevDatabase();

    it(
      'the scaffold carries the same renames migration plan plans; migrate keeps rows and policies, and later changes apply',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedTableWithObjects(ctx, db.connectionString, 'R2');

        const scaffold = await runMigrationNew(ctx, [
          '--name',
          'rename-user-profile',
          '--rename',
          'userProfile=UserProfile',
        ]);
        expect(scaffold.exitCode, `R2.05: migration new: ${scaffold.stderr}`).toBe(0);
        const latest = getLatestMigrationDir(ctx);
        expect(latest, 'R2.05: scaffold dir').toBeDefined();
        const packageDir = join(ctx.testDir, 'migrations', 'app', latest!);
        const migrationTs = readFileSync(join(packageDir, 'migration.ts'), 'utf-8');
        expect(migrationTs, 'R2.05: table rename call').toMatch(/this\.renameTable\(/);
        expect(migrationTs, 'R2.05: constraint rename calls').toMatch(/this\.renameConstraint\(/);
        expect(migrationTs, 'R2.05: index rename calls').toMatch(/this\.renameIndex\(/);

        const emitted = await selfEmitMigration(ctx, ['--dir', `migrations/app/${latest}`]);
        expect(emitted.exitCode, `R2.06: self-emit: ${emitted.stderr}`).toBe(0);
        const ops = JSON.parse(readFileSync(join(packageDir, 'ops.json'), 'utf-8')) as {
          readonly label: string;
        }[];
        expect(
          ops.map((op) => op.label),
          'R2.06: the same renames migration plan plans',
        ).toEqual(RENAME_LABELS);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `R2.07: migrate: ${apply.stderr}`).toBe(0);
        await expectRenameApplied(ctx, db.connectionString, 'R2.08');
        await expectLaterChangesApply(ctx, db.connectionString, 'R2.09');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
