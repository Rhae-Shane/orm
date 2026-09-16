import type { PslDiagnostic, PslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { nodePslSpan } from '../../resolve';
import { TaggedLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, TaggedLiteralArgType, TaggedLiteralValue } from '../types';
import { leafDiagnostic } from './diagnostic';

const CANONICALIZATION_FAILURES: Record<
  'interpolation' | 'nul' | 'too-large',
  { readonly code: PslDiagnosticCode; readonly message: string }
> = {
  interpolation: {
    code: 'PSL_TAGGED_LITERAL_INTERPOLATION',
    message: 'Tagged literals do not support $' + '{...} interpolation.',
  },
  nul: {
    code: 'PSL_TAGGED_LITERAL_NUL',
    message: 'Tagged literals must not contain NUL characters.',
  },
  'too-large': {
    code: 'PSL_TAGGED_LITERAL_TOO_LARGE',
    message: 'Tagged literal exceeds 65536 bytes.',
  },
};

/** A `tag`...`` or `tag"..."` argument whose tag is one of `tags`, in registration order. */
export function taggedLiteral(tags: readonly string[]): TaggedLiteralArgType<AttributeCtx> {
  return {
    kind: 'taggedLiteral',
    label: `${tags[0] ?? 'tag'}\`...\``,
    tags,
    parse: (arg, ctx): Result<TaggedLiteralValue, readonly PslDiagnostic[]> => {
      const literal = TaggedLiteralExprAst.cast(arg.syntax);
      if (literal === undefined) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a tagged literal')]);
      }
      const tag = literal.tag();
      if (!tags.includes(tag)) {
        return notOk([
          leafDiagnostic(
            ctx,
            arg,
            `Unknown literal tag "${tag}". Known tags: ${tags.join(', ')}.`,
            'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
          ),
        ]);
      }
      const canonical = literal.canonicalization();
      if (!canonical.ok) {
        const failure = CANONICALIZATION_FAILURES[canonical.reason];
        return notOk([leafDiagnostic(ctx, arg, failure.message, failure.code)]);
      }
      return ok({ tag, body: canonical.body, span: nodePslSpan(literal.syntax, ctx.sourceFile) });
    },
  };
}
