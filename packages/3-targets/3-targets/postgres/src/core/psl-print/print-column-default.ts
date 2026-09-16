import type { PslFieldAttribute } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import {
  buildAttribute,
  escapePslString,
  formatPslListLiteralValue,
  formatPslValue,
  type PslDefaultValueFormat,
  positionalArg,
  pslDefaultValueFormat,
} from '../psl-infer/psl-literals';

/** The two function defaults Prisma 8 PSL spells by name; every other one is `dbgenerated`. */
const NAMED_FUNCTION_DEFAULTS = new Set(['now()', 'autoincrement()']);

/**
 * A value the field's own literal format declines — a JSON object, for
 * instance — still has to reach the file as something PSL parses, so it goes
 * as the JSON text of the value.
 */
const jsonText: PslDefaultValueFormat = (value) => formatPslValue(JSON.stringify(value));

/**
 * The `@default(…)` attribute for a storage column, or `undefined` when the
 * column carries no default.
 *
 * A literal prints as the PSL literal its codec reads back, with a number
 * printing unquoted from its decimal text; `now()` and `autoincrement()` print
 * by name; every other function default prints as `dbgenerated("…")`. This is
 * the one place the `dbgenerated` spelling is decided.
 */
export function printColumnDefault(input: {
  readonly column: StorageColumn;
  readonly pslTypeName: string;
  readonly isEnum: boolean;
}): PslFieldAttribute | undefined {
  const columnDefault = input.column.default;
  if (columnDefault === undefined) {
    return undefined;
  }

  if (columnDefault.kind === 'function') {
    const { expression } = columnDefault;
    const argument = NAMED_FUNCTION_DEFAULTS.has(expression)
      ? expression
      : `dbgenerated("${escapePslString(expression)}")`;
    return buildAttribute('field', 'default', [positionalArg(argument)]);
  }

  const format = input.isEnum ? formatPslValue : pslDefaultValueFormat(input.pslTypeName);
  const { value } = columnDefault;
  const literal = Array.isArray(value)
    ? (formatPslListLiteralValue(value, format) ?? formatPslListLiteralValue(value, jsonText))
    : (format(value) ?? jsonText(value));
  return buildAttribute('field', 'default', [
    positionalArg(literal ?? `"${escapePslString(String(value))}"`),
  ]);
}
