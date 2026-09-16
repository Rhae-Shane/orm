import { describe, expect, it } from 'vitest';
import {
  decodeBooleanPsl,
  decodeJsonTextPsl,
  decodeNumberPsl,
  decodeStringPsl,
  encodeBooleanPsl,
  encodeJsonTextPsl,
  encodeNumberPsl,
  encodeStringPsl,
  pslLiteralKindError,
} from '../src/exports/codec';

describe('string helpers', () => {
  it('round-trips a string through a string literal', () => {
    const literal = encodeStringPsl('a"b\\c');
    expect(literal).toEqual({ kind: 'string', text: 'a"b\\c' });
    expect(decodeStringPsl('pg/text@1', literal)).toBe('a"b\\c');
  });

  it('rejects a number literal naming the codec', () => {
    expect(() => decodeStringPsl('pg/text@1', { kind: 'number', text: '1' })).toThrow(
      'pg/text@1 reads a string literal; got a number 1',
    );
  });
});

describe('number helpers', () => {
  it.each([
    [1, '1'],
    [-1.25, '-1.25'],
    [0, '0'],
    [1e-7, '0.0000001'],
    [1.5e-10, '0.00000000015'],
    [1e21, '1000000000000000000000'],
    [-1.25e22, '-12500000000000000000000'],
    [123.456, '123.456'],
  ])('writes %s as %s with no exponent', (value, text) => {
    expect(encodeNumberPsl(value)).toEqual({ kind: 'number', text });
  });

  it('round-trips a number through a number literal', () => {
    expect(decodeNumberPsl('pg/int4@1', encodeNumberPsl(42))).toBe(42);
    expect(decodeNumberPsl('pg/float8@1', encodeNumberPsl(1e-7))).toBe(1e-7);
  });

  it('reads a keyword number literal', () => {
    expect(decodeNumberPsl('pg/float8@1', { kind: 'number', text: 'NaN' })).toBeNaN();
    expect(decodeNumberPsl('pg/float8@1', { kind: 'number', text: '-Infinity' })).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });

  it('rejects a string literal naming the codec', () => {
    expect(() => decodeNumberPsl('pg/int4@1', { kind: 'string', text: '1' })).toThrow(
      'pg/int4@1 reads a number literal; got a string "1"',
    );
  });
});

describe('boolean helpers', () => {
  it('round-trips a boolean through a boolean literal', () => {
    expect(encodeBooleanPsl(true)).toEqual({ kind: 'boolean', text: 'true' });
    expect(encodeBooleanPsl(false)).toEqual({ kind: 'boolean', text: 'false' });
    expect(decodeBooleanPsl('pg/bool@1', encodeBooleanPsl(true))).toBe(true);
    expect(decodeBooleanPsl('pg/bool@1', encodeBooleanPsl(false))).toBe(false);
  });

  it('rejects a string literal naming the codec', () => {
    expect(() => decodeBooleanPsl('pg/bool@1', { kind: 'string', text: 'true' })).toThrow(
      'pg/bool@1 reads a boolean literal; got a string "true"',
    );
  });
});

describe('JSON text helpers', () => {
  it('round-trips a JSON value through a string literal holding JSON text', () => {
    const json = { a: 1, b: ['x', null, true], c: 'quote " backslash \\' };
    const literal = encodeJsonTextPsl(json);
    expect(literal).toEqual({ kind: 'string', text: JSON.stringify(json) });
    expect(decodeJsonTextPsl('pg/jsonb@1', literal)).toEqual(json);
  });

  it('round-trips JSON null', () => {
    expect(decodeJsonTextPsl('pg/jsonb@1', encodeJsonTextPsl(null))).toBeNull();
  });

  it('rejects a number literal naming the codec', () => {
    expect(() => decodeJsonTextPsl('pg/jsonb@1', { kind: 'number', text: '1' })).toThrow(
      'pg/jsonb@1 reads a string literal holding JSON text; got a number 1',
    );
  });

  it('rejects a string that is not JSON naming the codec', () => {
    expect(() => decodeJsonTextPsl('pg/jsonb@1', { kind: 'string', text: '{a:1}' })).toThrow(
      /^pg\/jsonb@1 reads a string literal holding JSON text; got a string "\{a:1\}" that is not valid JSON: /,
    );
  });
});

describe('pslLiteralKindError', () => {
  it('names the codec, the expected kind, and the literal it got', () => {
    expect(pslLiteralKindError('pg/int4@1', 'number', { kind: 'boolean', text: 'true' })).toEqual(
      new Error('pg/int4@1 reads a number literal; got a boolean true'),
    );
  });
});
