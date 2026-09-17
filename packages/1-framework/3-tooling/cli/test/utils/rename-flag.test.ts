import { describe, expect, it } from 'vitest';
import { parseRenameFlags } from '../../src/utils/rename-flag';

function parsedValue(values: readonly string[]) {
  const result = parseRenameFlags(values);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : undefined;
}

function failureOf(values: readonly string[]) {
  const result = parseRenameFlags(values);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.failure.toEnvelope();
}

describe('parseRenameFlags', () => {
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
    const result = parseRenameFlags(['a=b', 'c=d']);
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
  ])('rejects a malformed value (%s) with CLI.INVALID_RENAME_FLAG', (_label, value) => {
    const envelope = failureOf([value]);
    expect(envelope).toMatchObject({
      code: 'CLI.INVALID_RENAME_FLAG',
      summary: expect.stringContaining(value.trim() === '' ? '--rename' : value),
    });
    expect(envelope?.fix).toContain('<from>=<to>');
  });

  it('accepts both sides qualified with the same namespace', () => {
    expect(parsedValue(['auth.userProfile=auth.UserProfile'])).toEqual([
      {
        from: { namespaceId: 'auth', name: 'userProfile' },
        to: { namespaceId: 'auth', name: 'UserProfile' },
      },
    ]);
  });

  it('rejects a value that moves the storage to another namespace', () => {
    expect(failureOf(['auth.userProfile=sales.UserProfile'])?.summary).toBe(
      'Invalid --rename value "auth.userProfile=sales.UserProfile": a rename cannot move "auth.userProfile" to namespace "sales".',
    );
  });

  it('rejects a value whose two sides name the same storage', () => {
    expect(failureOf(['userProfile=userProfile'])).toMatchObject({
      code: 'CLI.INVALID_RENAME_FLAG',
      summary: expect.stringContaining('userProfile=userProfile'),
    });
  });

  it('rejects two values that rename the same storage, naming it', () => {
    expect(failureOf(['userProfile=UserProfile', 'userProfile=Profile'])?.summary).toBe(
      'Invalid --rename value "userProfile=Profile": "userProfile" is renamed more than once.',
    );
  });

  it('names the qualified storage when two qualified values rename it', () => {
    expect(failureOf(['auth.userProfile=UserProfile', 'auth.userProfile=Profile'])?.summary).toBe(
      'Invalid --rename value "auth.userProfile=Profile": "auth.userProfile" is renamed more than once.',
    );
  });

  it('rejects two values that rename to the same name, naming it', () => {
    expect(failureOf(['userProfile=UserProfile', 'profile=UserProfile'])?.summary).toBe(
      'Invalid --rename value "profile=UserProfile": more than one value renames to "UserProfile".',
    );
  });
});
