import type { Codec, PslLiteral } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const instanceCtx = { name: '<test>' };

const strings = ['hello', 'a"b\\c', ''];
const integers = [0, 42, -7];
const bigints = [0n, 9007199254740993n, -5n];
const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

const samples: Record<string, readonly unknown[]> = {
  'sql/char@1': strings,
  'sql/varchar@1': strings,
  'sql/text@1': strings,
  'sql/int@1': integers,
  'sql/float@1': [1.5, -0.25, 1e21, 1e-7],
  'pg/text@1': strings,
  'pg/enum@1': ['active'],
  'pg/char@1': strings,
  'pg/varchar@1': strings,
  'pg/int@1': integers,
  'pg/float@1': [1.5, -0.25],
  'pg/int4@1': integers,
  'pg/int2@1': integers,
  'pg/int8@1': bigints,
  'pg/int8number@1': [...integers, Number.MAX_SAFE_INTEGER],
  'pg/float4@1': [1.5, -0.25, ...nonFinite],
  'pg/float8@1': [1.5, -0.25, 1e21, 1e-7, ...nonFinite],
  'pg/numeric@1': [
    '1.50',
    '0',
    '-7.5',
    '123456789012345678901234567890.5',
    'NaN',
    'Infinity',
    '-Infinity',
  ],
  'pg/unboundedint@1': bigints,
  'pg/date-temporal@1': [Temporal.PlainDate.from('2026-01-02')],
  'pg/timestamp-temporal@1': [Temporal.PlainDateTime.from('2026-01-02T03:04:05.999999999')],
  'pg/timestamptz-temporal@1': [Temporal.Instant.from('2026-01-02T03:04:05.123456789Z')],
  'pg/time-temporal@1': [Temporal.PlainTime.from('03:04:05.123456')],
  'pg/date-string@1': ['2026-01-02'],
  'pg/timestamp-string@1': ['2026-01-02 03:04:05'],
  'pg/timestamptz-string@1': ['2026-01-02 03:04:05+00'],
  'pg/timestamptz-date@1': [new Date('2026-01-02T03:04:05.123Z')],
  'pg/time-string@1': ['03:04:05'],
  'pg/timetz@1': ['03:04:05+02:00'],
  'pg/bool@1': [true, false],
  'pg/bit@1': ['0101'],
  'pg/varbit@1': ['00001111'],
  'pg/bytea@1': [new Uint8Array([0xde, 0xad, 0xbe, 0xef]), new Uint8Array(0)],
  'pg/uuid@1': ['123e4567-e89b-12d3-a456-426614174000'],
  'pg/inet@1': ['192.168.0.1/24'],
  'pg/interval@1': [{ months: 13, days: 2, micros: 3_000_000n }],
  'pg/json@1': [{ a: 1 }, [1, 'x'], null, 'str', 3, true],
  'pg/jsonb@1': [{ a: 1 }, [1, 'x'], null, 'str', 3, true],
  'pg/text-array@1': [['a', 'b'], []],
};

function isTemporal(value: unknown): value is { toString(): string } {
  return typeof value === 'object' && value !== null && 'equals' in value;
}

function expectSame(actual: unknown, expected: unknown): void {
  if (isTemporal(expected)) {
    expect(String(actual)).toBe(String(expected));
    return;
  }
  expect(actual).toEqual(expected);
}

const anyParams = { typeName: 'Status' } as never;

const codecs = codecDescriptors.map((descriptor): [string, Codec] => [
  descriptor.codecId,
  descriptor.factory(anyParams)(instanceCtx),
]);

function codecFor(id: string): Codec {
  const found = codecs.find(([codecId]) => codecId === id);
  if (found === undefined) throw new Error(`no codec ${id}`);
  return found[1];
}

const cases = codecs.flatMap(([id, codec]) =>
  (samples[id] ?? []).map((value): [string, unknown, Codec] => [id, value, codec]),
);

describe('every registered Postgres codec', () => {
  it('has at least one sample in the table', () => {
    expect(new Set(codecs.map(([id]) => id))).toEqual(new Set(Object.keys(samples)));
  });

  it.each(cases)('%s round-trips %s through its PSL literal', (_id, value, codec) => {
    expectSame(codec.decodePsl(codec.encodePsl(value)), value);
  });

  it.each(codecs)('%s rejects a wrong-kind literal with a message naming it', (id, codec) => {
    const wrong: PslLiteral =
      id === 'pg/bool@1' ? { kind: 'number', text: '1' } : { kind: 'boolean', text: 'true' };
    expect(() => codec.decodePsl(wrong)).toThrow(id);
  });
});

describe('integer codecs', () => {
  it.each(['pg/int4@1', 'pg/int2@1', 'pg/int8number@1', 'pg/int@1', 'sql/int@1'])(
    '%s rejects 1.5',
    (id) => {
      expect(() => codecFor(id).decodePsl({ kind: 'number', text: '1.5' })).toThrow(
        `${id} reads a whole number literal; got a number 1.5`,
      );
    },
  );

  it.each(['pg/int8@1', 'pg/unboundedint@1'])('%s reads every digit of a big integer', (id) => {
    expect(codecFor(id).decodePsl({ kind: 'number', text: '9007199254740993' })).toBe(
      9007199254740993n,
    );
    expect(codecFor(id).encodePsl(9007199254740993n)).toEqual({
      kind: 'number',
      text: '9007199254740993',
    });
  });

  it.each(['pg/int8@1', 'pg/unboundedint@1'])('%s rejects 1.5', (id) => {
    expect(() => codecFor(id).decodePsl({ kind: 'number', text: '1.5' })).toThrow(
      `${id} reads a whole number literal; got a number 1.5`,
    );
  });

  it('pg/int8number@1 rejects a whole number outside the safe range', () => {
    expect(() =>
      codecFor('pg/int8number@1').decodePsl({ kind: 'number', text: '9007199254740993' }),
    ).toThrow('pg/int8number@1');
  });
});

describe('pg/numeric@1', () => {
  const numeric = codecFor('pg/numeric@1');

  it.each([
    ['1.50', '1.50'],
    ['007', '7'],
    ['-0', '0'],
    ['00.10', '0.10'],
    ['-007.50', '-7.50'],
    ['-0.00', '0.00'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['-Infinity', '-Infinity'],
  ])('reads the number literal %s as %s', (text, expected) => {
    expect(numeric.decodePsl({ kind: 'number', text })).toBe(expected);
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('reads the string literal "%s"', (text) => {
    expect(numeric.decodePsl({ kind: 'string', text })).toBe(text);
    expect(numeric.encodePsl(text)).toEqual({ kind: 'string', text });
  });

  it('prints a finite decimal as a number literal', () => {
    expect(numeric.encodePsl('1.50')).toEqual({ kind: 'number', text: '1.50' });
  });

  it.each([
    ['1.50', '1.50'],
    ['007', '7'],
    ['-0.00', '0.00'],
  ])('reads the string literal "%s" holding a decimal as %s', (text, expected) => {
    expect(numeric.decodePsl({ kind: 'string', text })).toBe(expected);
  });

  it('rejects a string that holds neither a decimal nor a special value', () => {
    expect(() => numeric.decodePsl({ kind: 'string', text: 'abc' })).toThrow(
      'pg/numeric@1 reads a number literal, or a string holding a decimal, "NaN", "Infinity", "-Infinity"; got a string "abc"',
    );
    expect(() => numeric.decodePsl({ kind: 'string', text: '1e5' })).toThrow('pg/numeric@1');
  });
});

describe('float codecs', () => {
  it.each(['pg/float4@1', 'pg/float8@1'])('%s reads "NaN" and NaN and prints "NaN"', (id) => {
    const codec = codecFor(id);
    expect(codec.decodePsl({ kind: 'string', text: 'NaN' })).toBeNaN();
    expect(codec.decodePsl({ kind: 'number', text: 'NaN' })).toBeNaN();
    expect(codec.encodePsl(Number.NaN)).toEqual({ kind: 'string', text: 'NaN' });
    expect(codec.encodePsl(1.5)).toEqual({ kind: 'number', text: '1.5' });
  });

  it.each(['pg/float4@1', 'pg/float8@1'])('%s stores a non-finite value as a JSON string', (id) => {
    const codec = codecFor(id);
    expect(codec.encodeJson(Number.NaN)).toBe('NaN');
    expect(codec.encodeJson(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(codec.encodeJson(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
    expect(codec.encodeJson(1.5)).toBe(1.5);
    expect(codec.decodeJson('NaN')).toBeNaN();
    expect(codec.decodeJson('Infinity')).toBe(Number.POSITIVE_INFINITY);
    expect(codec.decodeJson('-Infinity')).toBe(Number.NEGATIVE_INFINITY);
    expect(codec.decodeJson(1.5)).toBe(1.5);
    expect(() => codec.decodeJson('1.5')).toThrow(id);
  });

  it.each(['pg/float@1', 'sql/float@1'])('%s refuses "NaN"', (id) => {
    expect(() => codecFor(id).decodePsl({ kind: 'string', text: 'NaN' })).toThrow(id);
    expect(() => codecFor(id).decodePsl({ kind: 'number', text: 'NaN' })).toThrow(id);
  });
});

describe('document codecs', () => {
  it('pg/jsonb@1 prints an object as JSON text', () => {
    expect(codecFor('pg/jsonb@1').encodePsl({ a: 1 })).toEqual({ kind: 'string', text: '{"a":1}' });
  });

  it('pg/json@1 rejects a string that is not JSON', () => {
    expect(() => codecFor('pg/json@1').decodePsl({ kind: 'string', text: '{' })).toThrow(
      'pg/json@1 reads a string literal holding JSON text',
    );
  });

  it('pg/bytea@1 prints base64 text', () => {
    expect(codecFor('pg/bytea@1').encodePsl(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toEqual({
      kind: 'string',
      text: '3q2+7w==',
    });
  });

  it('pg/interval@1 prints an ISO duration', () => {
    expect(
      codecFor('pg/interval@1').encodePsl({ months: 13, days: 2, micros: 3_000_000n }),
    ).toEqual({ kind: 'string', text: 'P1Y1M2DT3S' });
  });
});
