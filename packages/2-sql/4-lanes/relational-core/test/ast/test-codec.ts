/**
 * Test-only helper that constructs a SQL-family `Codec` instance from author-side encode/decode functions. Replaces the legacy public `mkCodec()` factory (deleted under TML-2357); tests that need a stub codec for behavioural assertions instantiate one through this helper rather than going through `descriptor.factory(...)`.
 */
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecTrait,
  decodeJsonTextPsl,
  encodeJsonTextPsl,
  type PslLiteral,
} from '@internal/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '../../src/ast/codec-types';

type JsonRoundTripConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      encodeJson?: (value: TInput) => JsonValue;
      decodeJson?: (json: JsonValue) => TInput;
    }
  : {
      encodeJson: (value: TInput) => JsonValue;
      decodeJson: (json: JsonValue) => TInput;
    };

export function defineTestCodec<
  Id extends string,
  const TTraits extends readonly CodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: {
    typeId: Id;
    targetTypes?: readonly string[];
    encode: (value: TInput, ctx: SqlCodecCallContext) => TWire | Promise<TWire>;
    decode: (wire: TWire, ctx: SqlCodecCallContext) => TInput | Promise<TInput>;
    traits?: TTraits;
  } & JsonRoundTripConfig<TInput>,
): Codec<Id, TTraits, TWire, TInput> {
  const identity = (v: unknown) => v;
  const userEncode = config.encode;
  const userDecode = config.decode;
  const widenedConfig = config as {
    encodeJson?: (value: TInput) => JsonValue;
    decodeJson?: (json: JsonValue) => TInput;
  };
  const encodeJson = (widenedConfig.encodeJson ?? identity) as (value: TInput) => JsonValue;
  const decodeJson = (widenedConfig.decodeJson ?? identity) as (json: JsonValue) => TInput;
  const encodePsl = (value: TInput): PslLiteral => {
    const json = encodeJson(value);
    if (typeof json === 'string') return { kind: 'string', text: json };
    if (typeof json === 'number') return { kind: 'number', text: String(json) };
    if (typeof json === 'boolean') return { kind: 'boolean', text: String(json) };
    return encodeJsonTextPsl(json);
  };
  const decodePsl = (literal: PslLiteral): TInput => {
    if (literal.kind === 'number') return decodeJson(Number(literal.text));
    if (literal.kind === 'boolean') return decodeJson(literal.text === 'true');
    return decodeJson(decodeJsonTextPsl(config.typeId, literal));
  };
  return {
    id: config.typeId,
    encode: (value, ctx) => {
      try {
        return Promise.resolve(userEncode(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    decode: (wire, ctx) => {
      try {
        return Promise.resolve(userDecode(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    encodeJson,
    decodeJson,
    encodePsl,
    decodePsl,
  } as Codec<Id, TTraits, TWire, TInput>;
}
