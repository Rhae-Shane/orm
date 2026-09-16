import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';

const codec = pgVectorDescriptor.factory({ length: 3 })({ name: '<test>' });

describe('pg/vector@1 PSL literal', () => {
  it('round-trips a vector through JSON text', () => {
    expect(codec.encodePsl([0.1, 0.2, 0.3])).toEqual({ kind: 'string', text: '[0.1,0.2,0.3]' });
    expect(codec.decodePsl({ kind: 'string', text: '[0.1,0.2,0.3]' })).toEqual([0.1, 0.2, 0.3]);
  });

  it('rejects a number literal naming the codec', () => {
    expect(() => codec.decodePsl({ kind: 'number', text: '1' })).toThrow('pg/vector@1');
  });

  it('rejects JSON of the wrong shape through decodeJson', () => {
    expect(() => codec.decodePsl({ kind: 'string', text: '{"a":1}' })).toThrow();
  });
});
