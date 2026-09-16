import type { Codec } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '../../src/ast/sql-codecs';

const instanceCtx = { name: '<test>' };
const strings = ['hello', 'a"b\\c', ''];

const table: readonly [string, Codec, readonly unknown[]][] = [
  ['sql/text@1', sqlTextDescriptor.factory()(instanceCtx), strings],
  ['sql/char@1', sqlCharDescriptor.factory({})(instanceCtx), strings],
  ['sql/varchar@1', sqlVarcharDescriptor.factory({})(instanceCtx), strings],
  ['sql/int@1', sqlIntDescriptor.factory()(instanceCtx), [0, 42, -7]],
  ['sql/float@1', sqlFloatDescriptor.factory()(instanceCtx), [1.5, -0.25, 1e21, 1e-7]],
];

const cases = table.flatMap(([id, codec, values]) =>
  values.map((value): [string, unknown, Codec] => [id, value, codec]),
);

describe('SQL base codecs', () => {
  it.each(cases)('%s round-trips %s through its PSL literal', (_id, value, codec) => {
    expect(codec.decodePsl(codec.encodePsl(value))).toEqual(value);
  });

  it.each(table)('%s rejects a boolean literal with a message naming it', (id, codec) => {
    expect(() => codec.decodePsl({ kind: 'boolean', text: 'true' })).toThrow(id);
  });

  it('sql/int@1 rejects 1.5', () => {
    const [, int] = table[3]!;
    expect(() => int.decodePsl({ kind: 'number', text: '1.5' })).toThrow(
      'sql/int@1 reads a whole number literal; got a number 1.5',
    );
  });

  it('sql/float@1 refuses "NaN" in both spellings', () => {
    const [, float] = table[4]!;
    expect(() => float.decodePsl({ kind: 'string', text: 'NaN' })).toThrow('sql/float@1');
    expect(() => float.decodePsl({ kind: 'number', text: 'NaN' })).toThrow('sql/float@1');
    expect(() => float.encodePsl(Number.NaN)).toThrow('sql/float@1');
  });
});
