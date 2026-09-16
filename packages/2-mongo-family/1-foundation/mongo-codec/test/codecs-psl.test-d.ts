import {
  decodeStringPsl,
  encodeStringPsl,
  type PslLiteral,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { mongoCodec } from '../src/codecs';

test('the factory requires encodePsl and decodePsl', () => {
  // @ts-expect-error encodePsl and decodePsl are required; the factory installs no default
  mongoCodec({
    typeId: 'demo/text@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });
});

test('the members are typed by TInput', () => {
  const codec = mongoCodec({
    typeId: 'demo/text@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    encodePsl: (value) => encodeStringPsl(value),
    decodePsl: (literal) => decodeStringPsl('demo/text@1', literal),
  });
  expectTypeOf(codec.encodePsl).parameter(0).toEqualTypeOf<string>();
  expectTypeOf(codec.encodePsl).returns.toEqualTypeOf<PslLiteral>();
  expectTypeOf(codec.decodePsl).returns.toEqualTypeOf<string>();
});
