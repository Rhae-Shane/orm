/**
 * The Prisma 8 interpreter reads every literal default through the column codec's `decodePsl`. These cases need the real Postgres codecs (`pg/numeric@1` canonicalises leading zeros; `pg/int8@1` keeps every digit) and the real PSL scalar type names, so they live here rather than in `contract-psl`, whose unit tests do not depend on a target pack.
 */
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { type PostgresSchema, postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import { postgresAuthoringTypes } from '../src/core/control-mutation-defaults';
import postgresAdapterDescriptor from '../src/exports/control';

const assembled = assembleAuthoringContributions([
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
]);

function columnDefaults(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const result = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: { sql: { scalarList: true } },
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
    },
    scalarColumnDescriptors: collectScalarTypeConstructors(postgresAuthoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: createPostgresBuiltinCodecLookup(),
  });
  if (!result.ok) return { columns: {}, diagnostics: result.failure.diagnostics };
  const namespace = result.value.storage.namespaces['public'] as PostgresSchema;
  const table = namespace.table['n'];
  const columns = Object.fromEntries(
    Object.entries(table?.columns ?? {}).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
  return { columns, diagnostics: [] };
}

describe('literal defaults through the real Postgres codecs', () => {
  it('lower a decimal to the text written, without leading zeros or the sign of zero', () => {
    expect(
      columnDefaults(`types {
  Price = Numeric(10, 2)
}

model N {
  id                  Int     @id
  long                Decimal @default(12345678901234567890.123456789)
  tiny                Decimal @default(0.000000000000000001)
  negative            Decimal @default(-1.25)
  whole               Decimal @default(10)
  bareTrailingZeros   Decimal @default(1.50)
  scaledTrailingZeros Price   @default(1.50)
  notANumber          Decimal @default(NaN)
  quotedNotANumber    Decimal @default("NaN")
  negativeZero        Decimal @default(-0)
  leadingZeros        Decimal @default(007)
  leadingZeroFraction Decimal @default(00.10)
  negativeLeadingZero Decimal @default(-007.50)
  scaledNegativeZero  Price   @default(-0.00)
}`),
    ).toEqual({
      columns: {
        long: { kind: 'literal', value: '12345678901234567890.123456789' },
        tiny: { kind: 'literal', value: '0.000000000000000001' },
        negative: { kind: 'literal', value: '-1.25' },
        whole: { kind: 'literal', value: '10' },
        bareTrailingZeros: { kind: 'literal', value: '1.50' },
        scaledTrailingZeros: { kind: 'literal', value: '1.50' },
        notANumber: { kind: 'literal', value: 'NaN' },
        quotedNotANumber: { kind: 'literal', value: 'NaN' },
        negativeZero: { kind: 'literal', value: '0' },
        leadingZeros: { kind: 'literal', value: '7' },
        leadingZeroFraction: { kind: 'literal', value: '0.10' },
        negativeLeadingZero: { kind: 'literal', value: '-7.50' },
        scaledNegativeZero: { kind: 'literal', value: '0.00' },
      },
      diagnostics: [],
    });
  });

  it('lower every digit written on a big integer column', () => {
    expect(
      columnDefaults(`model N {
  id       Int    @id
  big      BigInt @default(9007199254740993)
  smallest BigInt @default(-9223372036854775808)
  safe     BigInt @default(42)
}`),
    ).toEqual({
      columns: {
        big: { kind: 'literal', value: '9007199254740993' },
        smallest: { kind: 'literal', value: '-9223372036854775808' },
        safe: { kind: 'literal', value: '42' },
      },
      diagnostics: [],
    });
  });

  it('lower each list element from its text', () => {
    expect(
      columnDefaults(`model N {
  id       Int       @id
  decimals Decimal[] @default([12345678901234567890.123456789, 1.50, -0, 007])
  bigs     BigInt[]  @default([9007199254740993, -1])
  ints     Int[]     @default([1, -2])
}`),
    ).toEqual({
      columns: {
        decimals: { kind: 'literal', value: ['12345678901234567890.123456789', '1.50', '0', '7'] },
        bigs: { kind: 'literal', value: ['9007199254740993', '-1'] },
        ints: { kind: 'literal', value: [1, -2] },
      },
      diagnostics: [],
    });
  });

  it('keep numbers on columns whose codec reads a JSON number, and NaN as its JSON string', () => {
    expect(
      columnDefaults(`model N {
  id    Int   @id
  count Int   @default(-5)
  ratio Float @default(1.50)
  nan   Float @default("NaN")
  json  Jsonb @default("{\\"a\\":1}")
  none  Json  @default("null")
}`),
    ).toEqual({
      columns: {
        count: { kind: 'literal', value: -5 },
        ratio: { kind: 'literal', value: 1.5 },
        nan: { kind: 'literal', value: 'NaN' },
        json: { kind: 'literal', value: { a: 1 } },
        none: { kind: 'literal', value: null },
      },
      diagnostics: [],
    });
  });

  it('reject a number on a column whose codec reads text', () => {
    expect(
      columnDefaults(`model N {
  id      Int   @id
  payload Bytes @default(1234)
}`),
    ).toEqual({
      columns: {},
      diagnostics: [
        {
          code: 'PSL_INVALID_DEFAULT_LITERAL',
          message:
            'Field "N.payload": @default(1234) is not a value of pg/bytea@1: pg/bytea@1 reads a string literal; got a number 1234',
          sourceId: 'schema.prisma',
          span: { start: expect.any(Object), end: expect.any(Object) },
        },
      ],
    });
  });
});
