import type { PslLiteral } from '@internal/framework-components/codec';

/** The characters a PSL string literal cannot hold as written. */
export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Writes a codec's PSL literal as schema source: a string inside its quotes with escapes, a number or boolean as its text. */
export function formatPslLiteral(literal: PslLiteral): string {
  return literal.kind === 'string' ? `"${escapePslString(literal.text)}"` : literal.text;
}
