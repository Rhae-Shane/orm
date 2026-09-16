import type { JsonValue } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import {
  type Codec,
  type CodecCallContext,
  CodecImpl,
  type PslLiteral,
} from '../src/exports/codec';

test('PslLiteral carries a kind and the literal text', () => {
  expectTypeOf<PslLiteral['kind']>().toEqualTypeOf<'string' | 'number' | 'boolean'>();
  expectTypeOf<PslLiteral['text']>().toEqualTypeOf<string>();
  expectTypeOf<{ kind: 'number'; text: '1.50' }>().toMatchTypeOf<PslLiteral>();
  expectTypeOf<{ kind: 'json'; text: '{}' }>().not.toMatchTypeOf<PslLiteral>();
});

test('Codec requires encodePsl and decodePsl', () => {
  expectTypeOf<Codec['encodePsl']>().toEqualTypeOf<(value: unknown) => PslLiteral>();
  expectTypeOf<Codec['decodePsl']>().toEqualTypeOf<(literal: PslLiteral) => unknown>();
  expectTypeOf<
    Codec<string, readonly [], number, number>['decodePsl']
  >().returns.toEqualTypeOf<number>();
});

test('a CodecImpl subclass without the PSL methods does not compile', () => {
  // @ts-expect-error encodePsl and decodePsl are abstract and must be implemented
  class MissingPslCodec extends CodecImpl<'demo/int4@1', readonly [], number, number> {
    async encode(value: number, _ctx: CodecCallContext): Promise<number> {
      return value;
    }
    async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
      return wire;
    }
    encodeJson(value: number): JsonValue {
      return value;
    }
    decodeJson(json: JsonValue): number {
      return json as number;
    }
  }
  expectTypeOf<MissingPslCodec>().toMatchTypeOf<object>();
});

test('a CodecImpl subclass with the PSL methods compiles', () => {
  class CompletePslCodec extends CodecImpl<'demo/int4@1', readonly [], number, number> {
    async encode(value: number, _ctx: CodecCallContext): Promise<number> {
      return value;
    }
    async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
      return wire;
    }
    encodeJson(value: number): JsonValue {
      return value;
    }
    decodeJson(json: JsonValue): number {
      return json as number;
    }
    encodePsl(value: number): PslLiteral {
      return { kind: 'number', text: String(value) };
    }
    decodePsl(literal: PslLiteral): number {
      return Number(literal.text);
    }
  }
  expectTypeOf<CompletePslCodec>().toMatchTypeOf<
    Codec<'demo/int4@1', readonly [], number, number>
  >();
});
