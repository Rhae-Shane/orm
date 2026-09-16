import type { Codec, PslLiteral } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const instanceCtx = { name: '<test>' };
const strings = ['hello', 'a"b\\c', ''];
const integers = [0, 42, -7];

const samples: Record<string, readonly unknown[]> = {
  'sql/char@1': strings,
  'sql/varchar@1': strings,
  'sql/int@1': integers,
  'sql/float@1': [1.5, -0.25, 1e21],
  'sqlite/text@1': strings,
  'sqlite/integer@1': integers,
  'sqlite/real@1': [1.5, -0.25, 1e21, 1e-7],
  'sqlite/blob@1': [new Uint8Array([0xde, 0xad, 0xbe, 0xef]), new Uint8Array(0)],
  'sqlite/datetime@1': [new Date('2026-01-02T03:04:05.123Z')],
  'sqlite/json@1': [{ a: 1 }, [1, 'x'], null, 'str', 3, true],
  'sqlite/bigint@1': [0n, 9007199254740993n, -5n],
  'sqlite/bigintnumber@1': [...integers, Number.MAX_SAFE_INTEGER],
};

const codecs = codecDescriptors.map((descriptor): [string, Codec] => [
  descriptor.codecId,
  descriptor.factory({} as never)(instanceCtx),
]);

function codecFor(id: string): Codec {
  const found = codecs.find(([codecId]) => codecId === id);
  if (found === undefined) throw new Error(`no codec ${id}`);
  return found[1];
}

const cases = codecs.flatMap(([id, codec]) =>
  (samples[id] ?? []).map((value): [string, unknown, Codec] => [id, value, codec]),
);

describe('every registered SQLite codec', () => {
  it('has at least one sample in the table', () => {
    expect(new Set(codecs.map(([id]) => id))).toEqual(new Set(Object.keys(samples)));
  });

  it.each(cases)('%s round-trips %s through its PSL literal', (_id, value, codec) => {
    expect(codec.decodePsl(codec.encodePsl(value))).toEqual(value);
  });

  it.each(codecs)('%s rejects a wrong-kind literal with a message naming it', (id, codec) => {
    const wrong: PslLiteral = { kind: 'boolean', text: 'true' };
    expect(() => codec.decodePsl(wrong)).toThrow(id);
  });
});

describe('integer codecs', () => {
  it.each(['sqlite/integer@1', 'sqlite/bigintnumber@1', 'sqlite/bigint@1', 'sql/int@1'])(
    '%s rejects 1.5',
    (id) => {
      expect(() => codecFor(id).decodePsl({ kind: 'number', text: '1.5' })).toThrow(
        `${id} reads a whole number literal; got a number 1.5`,
      );
    },
  );

  it('sqlite/bigint@1 reads every digit of a big integer', () => {
    expect(
      codecFor('sqlite/bigint@1').decodePsl({ kind: 'number', text: '9007199254740993' }),
    ).toBe(9007199254740993n);
    expect(codecFor('sqlite/bigint@1').encodePsl(9007199254740993n)).toEqual({
      kind: 'number',
      text: '9007199254740993',
    });
  });

  it('sqlite/bigintnumber@1 rejects a whole number outside the safe range', () => {
    expect(() =>
      codecFor('sqlite/bigintnumber@1').decodePsl({ kind: 'number', text: '9007199254740993' }),
    ).toThrow('sqlite/bigintnumber@1');
  });
});

describe('sqlite/real@1', () => {
  const real = codecFor('sqlite/real@1');

  it('refuses "NaN" in both forms', () => {
    expect(() => real.decodePsl({ kind: 'string', text: 'NaN' })).toThrow('sqlite/real@1');
    expect(() => real.decodePsl({ kind: 'number', text: 'NaN' })).toThrow('sqlite/real@1');
    expect(() => real.encodePsl(Number.NaN)).toThrow('sqlite/real@1');
  });
});

describe('sqlite/datetime@1', () => {
  it('prints a Date as its ISO string', () => {
    expect(codecFor('sqlite/datetime@1').encodePsl(new Date('2026-01-02T03:04:05.123Z'))).toEqual({
      kind: 'string',
      text: '2026-01-02T03:04:05.123Z',
    });
  });

  it('rejects a string that is not a date', () => {
    expect(() => codecFor('sqlite/datetime@1').decodePsl({ kind: 'string', text: 'x' })).toThrow(
      'sqlite/datetime@1',
    );
  });
});

describe('sqlite/blob@1', () => {
  it('prints uppercase hex text', () => {
    expect(codecFor('sqlite/blob@1').encodePsl(new Uint8Array([0xde, 0xad]))).toEqual({
      kind: 'string',
      text: 'DEAD',
    });
  });
});
