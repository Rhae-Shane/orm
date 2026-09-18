/**
 * Reading a `@default(...)` literal: a written literal is classified into a literal type, the type
 * is checked against the column's codec by membership, and the codec's `decodeJson` converts the
 * value. No per-type code and no per-codec branch live here.
 *
 * ADR 253.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecLookup,
  describeDeclarations,
  isCompatible,
  type Literal,
  type LiteralTypeDeclaration,
  type LiteralTypeName,
  materializeCodec,
  readLiteral,
  type WrittenLiteral,
} from '@internal/framework-components/codec';
import type { SourceDiagnostic, SourceSpan } from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type { AuthoredColumnDefaultLiteralValue } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';

/** A `` json`...` `` body that is not a JSON document. */
export const PSL_INVALID_JSON_LITERAL: ContributedPslDiagnosticCode = 'PSL_INVALID_JSON_LITERAL';

/** A literal the column's codec declares it accepts but refuses to decode, and a literal no contract source can write. */
export const PSL_INVALID_DEFAULT_LITERAL: ContributedPslDiagnosticCode =
  'PSL_INVALID_DEFAULT_LITERAL';

/** A literal whose type the column's codec does not accept. */
export const PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE: ContributedPslDiagnosticCode =
  'PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE';

export interface LiteralDefaultColumn {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown> | undefined;
}

/** The column's `typeParams` as the codec reference carries them, so `vector(3)` checks its length. */
function codecRefTypeParams(
  typeParams: Record<string, unknown> | undefined,
): JsonValue | undefined {
  return typeParams === undefined
    ? undefined
    : blindCast<JsonValue, 'typeParams are read from PSL and validated by the codec paramsSchema'>(
        typeParams,
      );
}

export type LiteralDefaultResult =
  | { readonly ok: true; readonly value: AuthoredColumnDefaultLiteralValue }
  | { readonly ok: false; readonly diagnostic: SourceDiagnostic };

/** The written literal a tagged literal's body is, given the literal type its tag names. */
export function writtenLiteralForTagBody(
  literalType: LiteralTypeName,
  text: string,
): WrittenLiteral {
  switch (literalType) {
    case 'json':
      return { kind: 'json', text };
    case 'string':
      return { kind: 'string', text };
    case 'boolean':
      return { kind: 'boolean', value: text === 'true' };
    case 'i8':
    case 'i16':
    case 'i32':
    case 'i64':
    case 'bigint':
    case 'decimal':
    case 'float':
      return { kind: 'number', text };
  }
}

const REFUSAL_CODES = {
  'invalid-json': PSL_INVALID_JSON_LITERAL,
  'invalid-number': PSL_INVALID_DEFAULT_LITERAL,
} as const;

/** Where in a list literal a diagnostic is about, for a message: ` at element 2`. */
function at(elementIndex: number | undefined): string {
  return elementIndex === undefined ? '' : ` at element ${elementIndex + 1}`;
}

const VOWEL = /^[aeiou]/;

function article(name: string): string {
  return VOWEL.test(name) ? 'an' : 'a';
}

/** How a literal's type reads in a diagnostic: `bigint`, `string`, or `list` for a list literal. */
function literalTypeName(literal: Literal): string {
  return typeof literal.type === 'string' ? literal.type : 'list';
}

function scalarDeclarations(
  declarations: readonly LiteralTypeDeclaration[],
): readonly LiteralTypeDeclaration[] {
  return declarations.filter((declaration) => typeof declaration === 'string');
}

/**
 * Reads one `@default(...)` literal for a column. `isList` selects the check: a list column's
 * elements are each checked and decoded against the element codec's scalar declarations, while a
 * scalar column's literal is checked whole — so a codec declaring `{ list: [...] }` takes a PSL
 * list on a column that is not a list.
 */
export function lowerLiteralDefault(input: {
  readonly written: WrittenLiteral;
  readonly isList: boolean;
  readonly column: LiteralDefaultColumn;
  readonly codecLookup: CodecLookup | undefined;
  readonly fieldPath: string;
  readonly sourceId: string;
  readonly span: SourceSpan;
}): LiteralDefaultResult {
  const reject = (code: string, message: string): LiteralDefaultResult => ({
    ok: false,
    diagnostic: { code, message, sourceId: input.sourceId, span: input.span },
  });

  const read = readLiteral(input.written);
  if (!read.ok) {
    return reject(
      REFUSAL_CODES[read.reason],
      `Field "${input.fieldPath}"${at(read.elementIndex)}: ${read.message}`,
    );
  }

  const descriptorFor = input.codecLookup?.descriptorFor;
  if (descriptorFor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": the codec lookup resolving column codecs exposes no descriptorFor, but the column was resolved from a codec descriptor.`,
    );
  }
  const descriptor = descriptorFor(input.column.codecId);
  if (descriptor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": no codec descriptor is registered for "${input.column.codecId}", but the column was resolved from one.`,
    );
  }

  const declared = descriptor.literalTypes ?? [];
  const declarations = input.isList ? scalarDeclarations(declared) : declared;
  const incompatible = (name: string, elementIndex?: number): LiteralDefaultResult =>
    reject(
      PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE,
      `Field "${input.fieldPath}"${at(elementIndex)}: ${input.column.codecId} is not compatible with ${article(name)} ${name} literal; it accepts ${describeDeclarations(declarations)}`,
    );

  const typeParams = codecRefTypeParams(input.column.typeParams);
  const codec = materializeCodec(
    descriptor,
    { codecId: input.column.codecId, ...ifDefined('typeParams', typeParams) },
    { name: input.fieldPath },
  );
  const decode = (value: JsonValue, elementIndex?: number): LiteralDefaultResult => {
    try {
      return {
        ok: true,
        value: blindCast<
          AuthoredColumnDefaultLiteralValue,
          'a codec decodes its own JSON form into the application value the contract builder accepts'
        >(codec.decodeJson(value)),
      };
    } catch (error) {
      return reject(
        PSL_INVALID_DEFAULT_LITERAL,
        `Field "${input.fieldPath}"${at(elementIndex)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  if (!input.isList) {
    if (!isCompatible(read.literal, declarations))
      return incompatible(literalTypeName(read.literal));
    return decode(blindCast<JsonValue, 'a literal value is JSON'>(read.literal.value));
  }

  if (input.written.kind !== 'list') {
    throw new InternalError(
      `Field "${input.fieldPath}": a list column's default was read as a ${input.written.kind} literal rather than a list.`,
    );
  }

  const decoded: AuthoredColumnDefaultLiteralValue[] = [];
  for (const [elementIndex, written] of input.written.elements.entries()) {
    // Each element is read on its own so its own type and position are both in hand; the whole-list
    // read above has already refused anything unreadable.
    const element = readLiteral(written);
    if (!element.ok || typeof element.literal.type !== 'string') {
      throw new InternalError(
        `Field "${input.fieldPath}": element ${elementIndex + 1} read differently on its own than as part of the list literal.`,
      );
    }
    if (!isCompatible(element.literal, declarations)) {
      return incompatible(element.literal.type, elementIndex);
    }
    const result = decode(element.literal.value, elementIndex);
    if (!result.ok) return result;
    decoded.push(result.value);
  }
  return { ok: true, value: decoded };
}
