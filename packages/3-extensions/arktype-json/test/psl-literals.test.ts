import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { arktypeJsonColumn } from '../src/core/arktype-json-codec';

const product = type({ name: 'string', price: 'number' });
const codec = arktypeJsonColumn(product).codecFactory({ name: '<test>' });

describe('pg/arktype-json@1 PSL literal', () => {
  it('round-trips a value through JSON text', () => {
    const value = { name: 'pen', price: 1.5 };
    expect(codec.encodePsl(value)).toEqual({ kind: 'string', text: '{"name":"pen","price":1.5}' });
    expect(codec.decodePsl({ kind: 'string', text: '{"name":"pen","price":1.5}' })).toEqual(value);
  });

  it('rejects a number literal naming the codec', () => {
    expect(() => codec.decodePsl({ kind: 'number', text: '1' })).toThrow(codec.id);
  });

  it('validates the parsed JSON against the schema', () => {
    expect(() => codec.decodePsl({ kind: 'string', text: '{"name":1}' })).toThrow();
  });
});
