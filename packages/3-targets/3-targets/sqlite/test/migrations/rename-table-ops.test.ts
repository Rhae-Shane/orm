import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { tableExistsAst } from '../../src/contract-free/checks';
import { RenameTableCall } from '../../src/core/migrations/op-factory-call';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('RenameTableCall (sqlite)', () => {
  it('is a widening renameTable call whose contract-side identity is the new name', () => {
    const call = new RenameTableCall('userProfile', 'UserProfile');

    expect(call).toMatchObject({
      factoryName: 'renameTable',
      operationClass: 'widening',
      oldTableName: 'userProfile',
      tableName: 'UserProfile',
      label: 'Rename table userProfile to UserProfile',
    });
  });

  it('renders ALTER TABLE ... RENAME TO with existence prechecks and a postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await new RenameTableCall('profile', 'account').toOp(lowerer);

    expect(received).toEqual([
      tableExistsAst('profile').tablePresent(),
      tableExistsAst('account').tableAbsent(),
      tableExistsAst('account').tablePresent(),
    ]);
    expect(op).toEqual({
      id: 'renameTable.profile',
      label: 'Rename table profile to account',
      summary: 'Renames table profile to account, keeping its rows',
      operationClass: 'widening',
      target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'account' } },
      precheck: [
        { description: 'ensure table "profile" exists', sql: 'LOWERED 1', params: ['p1'] },
        { description: 'ensure table "account" does not exist', sql: 'LOWERED 2', params: ['p2'] },
      ],
      execute: [
        {
          description: 'rename table "profile" to "account"',
          sql: 'ALTER TABLE "profile" RENAME TO "account"',
        },
      ],
      postcheck: [
        { description: 'verify table "account" exists', sql: 'LOWERED 3', params: ['p3'] },
      ],
    });
  });

  it('renames through a temporary name when only the case changes, which SQLite would otherwise refuse', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await new RenameTableCall('userProfile', 'UserProfile').toOp(lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"',
      'ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('toOp() without a lowerer reports MIGRATION.SQLITE_CONTROL_STACK_MISSING', async () => {
    const call = new RenameTableCall('userProfile', 'UserProfile');
    await expect(call.toOp()).rejects.toMatchObject({
      code: 'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
      meta: { factory: 'renameTable' },
    });
  });

  it('renderTypeScript() emits the facade call', () => {
    expect(new RenameTableCall('userProfile', 'UserProfile').renderTypeScript()).toBe(
      'this.renameTable({ table: "userProfile", to: "UserProfile" })',
    );
  });

  it('needs no facade import because the call is a method on the migration', () => {
    expect(new RenameTableCall('a', 'b').importRequirements()).toEqual([]);
  });
});
