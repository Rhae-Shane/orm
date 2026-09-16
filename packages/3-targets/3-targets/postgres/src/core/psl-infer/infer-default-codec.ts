import { type Codec, materializeCodec } from '@internal/framework-components/codec';
import { PG_TEXT_CODEC_ID } from '../codec-ids';
import { postgresCodecDescriptorRegistry } from '../registry';

/** The codec `contract emit` binds to each PSL type name the type map prints, so a default prints in the form emit reads. An enum column's members are strings either way, so it reads through the text codec. */
const CODEC_ID_BY_PSL_TYPE: ReadonlyMap<string, string> = new Map([
  ['String', 'pg/text@1'],
  ['Boolean', 'pg/bool@1'],
  ['Int', 'pg/int4@1'],
  ['SmallInt', 'pg/int2@1'],
  ['BigInt', 'pg/int8@1'],
  ['Float', 'pg/float8@1'],
  ['Real', 'pg/float4@1'],
  ['Numeric', 'pg/numeric@1'],
  ['Timestamp', 'pg/timestamp-temporal@1'],
  ['Timestamptz', 'pg/timestamptz-temporal@1'],
  ['Date', 'pg/date-temporal@1'],
  ['Time', 'pg/time-temporal@1'],
  ['Timetz', 'pg/timetz@1'],
  ['Json', 'pg/json@1'],
  ['Jsonb', 'pg/jsonb@1'],
  ['Bytes', 'pg/bytea@1'],
  ['Uuid', 'pg/uuid@1'],
  ['Inet', 'pg/inet@1'],
  ['VarChar', 'sql/varchar@1'],
  ['Char', 'sql/char@1'],
]);

const codecs = new Map<string, Codec>();

/** The codec a column's literal default prints through, or `undefined` for a PSL type no codec is bound to. Every Postgres codec is parameter-stateless, so one instance per codec id serves every column. */
export function defaultCodecFor(pslTypeName: string, isEnum: boolean): Codec | undefined {
  const codecId = isEnum ? PG_TEXT_CODEC_ID : CODEC_ID_BY_PSL_TYPE.get(pslTypeName);
  if (codecId === undefined) return undefined;
  const cached = codecs.get(codecId);
  if (cached !== undefined) return cached;
  const descriptor = postgresCodecDescriptorRegistry.descriptorFor(codecId);
  if (descriptor === undefined) return undefined;
  const codec = materializeCodec(descriptor, { codecId }, { name: `<infer:${codecId}>` });
  codecs.set(codecId, codec);
  return codec;
}
