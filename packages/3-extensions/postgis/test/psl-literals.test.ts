import { describe, expect, it } from 'vitest';
import { postgisGeometryDescriptor } from '../src/core/codecs';
import type { Geometry } from '../src/core/geojson';

const codec = postgisGeometryDescriptor.factory({ srid: 4326 })({ name: '<test>' });
const point: Geometry = { type: 'Point', coordinates: [1, 2], srid: 4326 };

describe('pg/geometry@1 PSL literal', () => {
  it('round-trips a geometry through its HEXEWKB string', () => {
    const literal = codec.encodePsl(point);
    expect(literal.kind).toBe('string');
    expect(literal.text).toBe(codec.encodeJson(point));
    expect(codec.decodePsl(literal)).toEqual(point);
  });

  it('rejects a number literal naming the codec', () => {
    expect(() => codec.decodePsl({ kind: 'number', text: '1' })).toThrow('pg/geometry@1');
  });
});
