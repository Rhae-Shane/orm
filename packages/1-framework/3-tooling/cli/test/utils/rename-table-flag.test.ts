import { describe, expect, it } from 'vitest';
import { parseRenameTableFlags } from '../../src/utils/rename-table-flag';

function parsedValue(values: readonly string[]) {
  const result = parseRenameTableFlags(values);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : undefined;
}

function failureOf(values: readonly string[]) {
  const result = parseRenameTableFlags(values);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.failure.toEnvelope();
}

describe('parseRenameTableFlags', () => {
  it('parses an unqualified pair', () => {
    expect(parsedValue(['userProfile=UserProfile'])).toEqual([
      { from: { name: 'userProfile' }, to: { name: 'UserProfile' } },
    ]);
  });

  it('parses a namespace qualifier on either side', () => {
    expect(parsedValue(['auth.userProfile=UserProfile', 'orderLine=sales.OrderLine'])).toEqual([
      { from: { namespaceId: 'auth', name: 'userProfile' }, to: { name: 'UserProfile' } },
      { from: { name: 'orderLine' }, to: { namespaceId: 'sales', name: 'OrderLine' } },
    ]);
  });

  it('keeps repeated values in the order given', () => {
    const result = parseRenameTableFlags(['a=b', 'c=d']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((intent) => `${intent.from.name}>${intent.to.name}`)).toEqual([
      'a>b',
      'c>d',
    ]);
  });

  it('returns no intents for no values', () => {
    expect(parsedValue([])).toEqual([]);
  });

  it.each([
    ['no separator', 'userProfile'],
    ['empty left side', '=UserProfile'],
    ['empty right side', 'userProfile='],
    ['two separators', 'a=b=c'],
    ['empty namespace', '.userProfile=UserProfile'],
    ['empty name after the namespace', 'auth.=UserProfile'],
    ['blank value', '   '],
  ])('rejects a malformed value (%s) with CLI.INVALID_RENAME_TABLE_FLAG', (_label, value) => {
    const envelope = failureOf([value]);
    expect(envelope).toMatchObject({
      code: 'CLI.INVALID_RENAME_TABLE_FLAG',
      summary: expect.stringContaining(value.trim() === '' ? '--rename-table' : value),
    });
    expect(envelope?.fix).toContain('<from>=<to>');
  });

  it('rejects a value whose two sides are the same table', () => {
    expect(failureOf(['userProfile=userProfile'])).toMatchObject({
      code: 'CLI.INVALID_RENAME_TABLE_FLAG',
      summary: expect.stringContaining('userProfile=userProfile'),
    });
  });

  it('rejects two values that rename the same table', () => {
    expect(failureOf(['userProfile=UserProfile', 'userProfile=Profile'])).toMatchObject({
      code: 'CLI.INVALID_RENAME_TABLE_FLAG',
      summary: expect.stringContaining('userProfile'),
    });
  });

  it('rejects two values that rename to the same table', () => {
    expect(failureOf(['userProfile=UserProfile', 'profile=UserProfile'])).toMatchObject({
      code: 'CLI.INVALID_RENAME_TABLE_FLAG',
      summary: expect.stringContaining('UserProfile'),
    });
  });
});
