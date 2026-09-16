import { decodeStringPsl, encodeStringPsl } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodec } from '../src/codecs';

describe('mongoCodec() PSL members', () => {
  const codec = mongoCodec({
    typeId: 'test/text@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    encodePsl: (value: string) => encodeStringPsl(value.toUpperCase()),
    decodePsl: (literal) => `read:${decodeStringPsl('test/text@1', literal)}`,
  });

  it('passes encodePsl and decodePsl through', () => {
    expect(codec.encodePsl('a')).toEqual({ kind: 'string', text: 'A' });
    expect(codec.decodePsl({ kind: 'string', text: 'A' })).toBe('read:A');
  });

  it('lets a decodePsl error propagate', () => {
    expect(() => codec.decodePsl({ kind: 'number', text: '1' })).toThrow('test/text@1');
  });
});
