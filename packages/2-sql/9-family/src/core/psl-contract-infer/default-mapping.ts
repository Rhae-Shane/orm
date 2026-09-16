import type { ColumnDefault, ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { Codec } from '@internal/framework-components/codec';
import { formatPslLiteral } from './psl-literal-format';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  readonly fallbackFunctionAttribute?: ((expression: string) => string | undefined) | undefined;
}

/** A literal default prints through the column codec, so the codec is required. */
export interface LiteralDefaultMappingOptions extends DefaultMappingOptions {
  readonly codec: Codec;
}

export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

type FunctionColumnDefault = Extract<ColumnDefault, { readonly kind: 'function' }>;

export function mapDefault(
  columnDefault: FunctionColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult;
export function mapDefault(
  columnDefault: ColumnDefault,
  options: LiteralDefaultMappingOptions,
): DefaultMappingResult;
export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions | LiteralDefaultMappingOptions,
): DefaultMappingResult {
  switch (columnDefault.kind) {
    case 'literal': {
      if (options === undefined || !('codec' in options)) {
        throw new TypeError('mapDefault: a literal default prints through its column codec');
      }
      return { attribute: `@default(${formatLiteral(columnDefault.value, options.codec)})` };
    }
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        options?.fallbackFunctionAttribute?.(columnDefault.expression);
      return attribute
        ? { attribute }
        : { comment: `// Raw default: ${columnDefault.expression.replace(/[\r\n]+/g, ' ')}` };
    }
  }
}

/** The contract holds the JSON form, so the codec reads it back before writing its PSL form; a `Date` is the one authored value JSON has no notation for and is already the codec's own value. A list column prints one literal per element. Any error the codec raises propagates. */
function formatLiteral(value: ColumnDefaultLiteralInputValue, codec: Codec): string {
  const literal = (element: ColumnDefaultLiteralInputValue) =>
    formatPslLiteral(
      codec.encodePsl(element instanceof Date ? element : codec.decodeJson(element)),
    );
  return Array.isArray(value) ? `[${value.map(literal).join(', ')}]` : literal(value);
}
