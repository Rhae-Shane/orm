/**
 * Shared `encodePsl` / `decodePsl` pairs for the common codec shapes. A codec whose value is a JS string, number, or boolean, or whose JSON form is a JSON document, delegates to one pair here. Every decode error has the same shape: `<codecId> reads a <expected> literal; got <what it got>`.
 */

import type { JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { PslLiteral } from './codec-types';

function describeLiteral(literal: PslLiteral): string {
  const text = literal.kind === 'string' ? JSON.stringify(literal.text) : literal.text;
  return `a ${literal.kind} ${text}`;
}

/** The error a codec throws when `literal` is not what it reads; `reads` completes "`<codecId> reads ...`". */
export function pslLiteralReadsError(
  codecId: string,
  reads: string,
  literal: PslLiteral,
  detail = '',
): Error {
  return new Error(`${codecId} reads ${reads}; got ${describeLiteral(literal)}${detail}`);
}

/** The error a codec throws when `literal` is not the kind it reads. */
export function pslLiteralKindError(codecId: string, expected: string, literal: PslLiteral): Error {
  return pslLiteralReadsError(codecId, `a ${expected} literal`, literal);
}

export function encodeStringPsl(value: string): PslLiteral {
  return { kind: 'string', text: value };
}

export function decodeStringPsl(codecId: string, literal: PslLiteral): string {
  if (literal.kind !== 'string') throw pslLiteralKindError(codecId, 'string', literal);
  return literal.text;
}

/** PSL has no exponent syntax, so the decimal point moves to where the exponent puts it. */
export function encodeNumberPsl(value: number): PslLiteral {
  const [coefficient = '', exponent] = String(value).split('e');
  if (exponent === undefined) return { kind: 'number', text: coefficient };
  const sign = coefficient.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = coefficient.slice(sign.length).split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  if (point <= 0) return { kind: 'number', text: `${sign}0.${'0'.repeat(-point)}${digits}` };
  if (point >= digits.length) {
    return { kind: 'number', text: `${sign}${digits}${'0'.repeat(point - digits.length)}` };
  }
  return { kind: 'number', text: `${sign}${digits.slice(0, point)}.${digits.slice(point)}` };
}

export function decodeNumberPsl(codecId: string, literal: PslLiteral): number {
  if (literal.kind !== 'number') throw pslLiteralKindError(codecId, 'number', literal);
  return Number(literal.text);
}

const WHOLE_NUMBER_TEXT = /^-?\d+$/;

/** The digits of a whole number literal, as written; an integer codec turns them into its own number type. */
export function decodeWholeNumberPsl(codecId: string, literal: PslLiteral): string {
  if (literal.kind !== 'number' || !WHOLE_NUMBER_TEXT.test(literal.text)) {
    throw pslLiteralKindError(codecId, 'whole number', literal);
  }
  return literal.text;
}

const NON_FINITE_TEXT = /^(?:NaN|-?Infinity)$/;

/** PSL has no number token for a non-finite value, so it is written as the quoted string `"NaN"`, `"Infinity"` or `"-Infinity"`. */
export function encodeFloatPsl(value: number): PslLiteral {
  return Number.isFinite(value) ? encodeNumberPsl(value) : { kind: 'string', text: String(value) };
}

export function decodeFloatPsl(codecId: string, literal: PslLiteral): number {
  if (literal.kind === 'number') return Number(literal.text);
  if (literal.kind === 'string' && NON_FINITE_TEXT.test(literal.text)) return Number(literal.text);
  throw pslLiteralReadsError(
    codecId,
    'a number literal or "NaN", "Infinity", "-Infinity"',
    literal,
  );
}

export function encodeBooleanPsl(value: boolean): PslLiteral {
  return { kind: 'boolean', text: value ? 'true' : 'false' };
}

export function decodeBooleanPsl(codecId: string, literal: PslLiteral): boolean {
  if (literal.kind !== 'boolean') throw pslLiteralKindError(codecId, 'boolean', literal);
  return literal.text === 'true';
}

const JSON_TEXT = 'a string literal holding JSON text';

export function encodeJsonTextPsl(json: JsonValue): PslLiteral {
  return { kind: 'string', text: JSON.stringify(json) };
}

export function decodeJsonTextPsl(codecId: string, literal: PslLiteral): JsonValue {
  if (literal.kind !== 'string') throw pslLiteralReadsError(codecId, JSON_TEXT, literal);
  try {
    return blindCast<JsonValue, 'JSON.parse only produces JSON values'>(JSON.parse(literal.text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw pslLiteralReadsError(codecId, JSON_TEXT, literal, ` that is not valid JSON: ${reason}`);
  }
}
