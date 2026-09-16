import {
  type Codec,
  decodeBooleanPsl,
  decodeJsonTextPsl,
  decodeNumberPsl,
  decodeStringPsl,
  encodeBooleanPsl,
  encodeJsonTextPsl,
  encodeNumberPsl,
  encodeStringPsl,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  type DefaultMappingOptions,
  mapDefault,
} from '../../src/core/psl-contract-infer/default-mapping';
import { formatPslLiteral } from '../../src/core/psl-contract-infer/psl-literal-format';

// Inline dialect-mapping fixture (the Postgres maps now live in the target);
// these cases exercise the neutral `mapDefault` with an injected mapping.
const injectedMapping: DefaultMappingOptions = {
  functionAttributes: { 'gen_random_uuid()': '@default(dbgenerated("gen_random_uuid()"))' },
  fallbackFunctionAttribute: (expression) => `@default(dbgenerated(${JSON.stringify(expression)}))`,
};

function codec(
  id: string,
  members: Pick<Codec, 'encodePsl' | 'decodePsl'> & Partial<Pick<Codec, 'decodeJson'>>,
): Codec {
  return {
    id,
    encode: async (value: unknown) => value,
    decode: async (wire: unknown) => wire,
    encodeJson: (value) => value as never,
    decodeJson: (json) => json as never,
    ...members,
  };
}

const text = codec('test/text@1', {
  encodePsl: (value) => encodeStringPsl(value as string),
  decodePsl: (literal) => decodeStringPsl('test/text@1', literal),
});
const number = codec('test/number@1', {
  encodePsl: (value) => encodeNumberPsl(value as number),
  decodePsl: (literal) => decodeNumberPsl('test/number@1', literal),
});
const boolean = codec('test/bool@1', {
  encodePsl: (value) => encodeBooleanPsl(value as boolean),
  decodePsl: (literal) => decodeBooleanPsl('test/bool@1', literal),
});
const json = codec('test/json@1', {
  encodePsl: (value) => encodeJsonTextPsl(value as never),
  decodePsl: (literal) => decodeJsonTextPsl('test/json@1', literal),
});
const refusing = codec('test/refusing@1', {
  decodeJson: () => {
    throw new Error('test/refusing@1 reads nothing');
  },
  encodePsl: (value) => encodeStringPsl(value as string),
  decodePsl: (literal) => decodeStringPsl('test/refusing@1', literal),
});

describe('mapDefault', () => {
  it('maps autoincrement()', () => {
    expect(mapDefault({ kind: 'function', expression: 'autoincrement()' })).toEqual({
      attribute: '@default(autoincrement())',
    });
  });

  it('maps now()', () => {
    expect(mapDefault({ kind: 'function', expression: 'now()' })).toEqual({
      attribute: '@default(now())',
    });
  });

  it('maps gen_random_uuid() when Postgres mapping is injected', () => {
    expect(
      mapDefault({ kind: 'function', expression: 'gen_random_uuid()' }, injectedMapping),
    ).toEqual({
      attribute: '@default(dbgenerated("gen_random_uuid()"))',
    });
  });

  it('maps unmapped Postgres defaults to dbgenerated when Postgres mapping is injected', () => {
    expect(mapDefault({ kind: 'function', expression: "'{}'::jsonb" }, injectedMapping)).toEqual({
      attribute: `@default(dbgenerated(${JSON.stringify("'{}'::jsonb")}))`,
    });
  });

  it('unrecognized function becomes comment', () => {
    expect(mapDefault({ kind: 'function', expression: 'custom_func()' })).toEqual({
      comment: '// Raw default: custom_func()',
    });
  });

  it('treats Postgres-specific functions as raw defaults without injected mapping', () => {
    expect(mapDefault({ kind: 'function', expression: 'gen_random_uuid()' })).toEqual({
      comment: '// Raw default: gen_random_uuid()',
    });
  });

  describe('literal defaults print through the column codec', () => {
    it('prints a boolean', () => {
      expect(mapDefault({ kind: 'literal', value: true }, { codec: boolean })).toEqual({
        attribute: '@default(true)',
      });
    });

    it('prints a number', () => {
      expect(mapDefault({ kind: 'literal', value: 42 }, { codec: number })).toEqual({
        attribute: '@default(42)',
      });
    });

    it('prints a string with its quotes, newlines, and tabs escaped', () => {
      expect(
        mapDefault({ kind: 'literal', value: 'line 1\nline 2\t"quoted"' }, { codec: text }),
      ).toEqual({ attribute: '@default("line 1\\nline 2\t\\"quoted\\"")' });
    });

    it('prints a JSON document as a string holding JSON text', () => {
      expect(mapDefault({ kind: 'literal', value: { a: 1 } }, { codec: json })).toEqual({
        attribute: '@default("{\\"a\\":1}")',
      });
    });

    it('prints a list one element at a time', () => {
      expect(mapDefault({ kind: 'literal', value: [1, 2] }, { codec: number })).toEqual({
        attribute: '@default([1, 2])',
      });
    });

    it('lets an error the codec raises propagate', () => {
      expect(() => mapDefault({ kind: 'literal', value: 'x' }, { codec: refusing })).toThrow(
        'test/refusing@1 reads nothing',
      );
    });
  });
});

describe('formatPslLiteral', () => {
  it.each([
    ['plain', '"plain"'],
    ['back\\slash', '"back\\\\slash"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['line\nbreak', '"line\\nbreak"'],
    ['carriage\rreturn', '"carriage\\rreturn"'],
  ])('writes the string %j as %s', (text, expected) => {
    expect(formatPslLiteral({ kind: 'string', text })).toBe(expected);
  });

  it('writes a number and a boolean as their text', () => {
    expect(formatPslLiteral({ kind: 'number', text: '9007199254740993' })).toBe('9007199254740993');
    expect(formatPslLiteral({ kind: 'boolean', text: 'false' })).toBe('false');
  });
});
