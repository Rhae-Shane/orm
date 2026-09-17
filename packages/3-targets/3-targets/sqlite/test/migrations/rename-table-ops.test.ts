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
    const op = await new RenameTableCall('userProfile', 'UserProfile').toOp(lowerer);

    expect(received).toEqual([
      tableExistsAst('userProfile').tablePresent(),
      tableExistsAst('UserProfile').tableAbsent(),
      tableExistsAst('UserProfile').tablePresent(),
    ]);
    expect(op).toEqual({
      id: 'renameTable.userProfile',
      label: 'Rename table userProfile to UserProfile',
      summary: 'Renames table userProfile to UserProfile, keeping its rows',
      operationClass: 'widening',
      target: {
        id: 'sqlite',
        details: { schema: 'main', objectType: 'table', name: 'UserProfile' },
      },
      precheck: [
        { description: 'ensure table "userProfile" exists', sql: 'LOWERED 1', params: ['p1'] },
        {
          description: 'ensure table "UserProfile" does not exist',
          sql: 'LOWERED 2',
          params: ['p2'],
        },
      ],
      execute: [
        {
          description: 'rename table "userProfile" to "UserProfile"',
          sql: 'ALTER TABLE "userProfile" RENAME TO "UserProfile"',
        },
      ],
      postcheck: [
        { description: 'verify table "UserProfile" exists', sql: 'LOWERED 3', params: ['p3'] },
      ],
    });
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
