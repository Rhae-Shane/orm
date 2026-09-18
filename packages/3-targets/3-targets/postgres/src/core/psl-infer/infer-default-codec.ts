/**
 * What a printed column's codec accepts as a literal default.
 *
 * `contract emit` binds a codec to each PSL type constructor the printer names, so a default has to
 * be written in the form that codec reads back. The binding itself lives in the adapter's authoring
 * type namespaces, which sit above this package; the table below restates it for the type names the
 * printer emits, and `adapter-postgres/test/printed-type-codecs.test.ts` fails if the two disagree
 * or if the printer gains a type name this table does not cover.
 */

import type { LiteralTypeDeclaration } from '@internal/framework-components/codec';
import { PG_TEXT_CODEC_ID } from '../codec-ids';
import { postgresCodecDescriptorRegistry } from '../registry';

/** The codec `contract emit` binds to each PSL type name the type map prints. */
export const CODEC_ID_BY_PRINTED_TYPE: ReadonlyMap<string, string> = new Map([
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

/**
 * The literal types a column of `pslTypeName` accepts. An enum column's default is a member name,
 * which is a string either way, so it reads through the text codec.
 */
export function literalTypesForPrintedType(
  pslTypeName: string,
  isEnum: boolean,
): readonly LiteralTypeDeclaration[] {
  const codecId = isEnum ? PG_TEXT_CODEC_ID : CODEC_ID_BY_PRINTED_TYPE.get(pslTypeName);
  if (codecId === undefined) return [];
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)?.literalTypes ?? [];
}
