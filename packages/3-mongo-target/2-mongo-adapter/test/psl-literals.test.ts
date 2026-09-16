import type { Codec, PslLiteral } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoStandardCodecs } from '../src/core/codecs';

const samples: Record<string, readonly unknown[]> = {
  'mongo/objectId@1': ['507f1f77bcf86cd799439011'],
  'mongo/string@1': ['hello', 'a"b\\c', ''],
  'mongo/double@1': [1.5, -0.25, 1e21],
  'mongo/int32@1': [0, 42, -7],
  'mongo/bool@1': [true, false],
  'mongo/date@1': [new Date('2026-01-02T03:04:05.123Z')],
  'mongo/vector@1': [[0.1, 0.2], []],
};

const codecs = mongoStandardCodecs.map((codec): [string, Codec] => [codec.id, codec]);

const cases = codecs.flatMap(([id, codec]) =>
  (samples[id] ?? []).map((value): [string, unknown, Codec] => [id, value, codec]),
);

describe('every standard Mongo codec', () => {
  it('has at least one sample in the table', () => {
    expect(new Set(codecs.map(([id]) => id))).toEqual(new Set(Object.keys(samples)));
  });

  it.each(cases)('%s round-trips %s through its PSL literal', (_id, value, codec) => {
    expect(codec.decodePsl(codec.encodePsl(value))).toEqual(value);
  });

  it.each(codecs)('%s rejects a wrong-kind literal with a message naming it', (id, codec) => {
    const wrong: PslLiteral =
      id === 'mongo/bool@1' ? { kind: 'number', text: '1' } : { kind: 'boolean', text: 'true' };
    expect(() => codec.decodePsl(wrong)).toThrow(id);
  });

  it('mongo/int32@1 rejects 1.5', () => {
    const [, int32] = codecs.find(([id]) => id === 'mongo/int32@1')!;
    expect(() => int32.decodePsl({ kind: 'number', text: '1.5' })).toThrow(
      'mongo/int32@1 reads a whole number literal; got a number 1.5',
    );
  });
});
