import type { TaggedLiteralValue } from '@internal/framework-components/control';
import { describeTaggedLiteralFailure } from '@internal/framework-components/control';
import type { PslDiagnostic, PslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import { nodePslSpan } from '../../resolve';
import { TaggedLiteralExprAst } from '../../syntax/ast/expressions';
import type { AttributeCtx, TaggedLiteralArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

const CANONICALIZATION_CODES: Record<'nul' | 'too-large', PslDiagnosticCode> = {
  nul: 'PSL_TAGGED_LITERAL_NUL',
  'too-large': 'PSL_TAGGED_LITERAL_TOO_LARGE',
};

/** A `` tag`...` `` or `tag"..."` argument whose tag is one of `tags`, in registration order. */
export function taggedLiteral(
  tags: readonly string[],
  options: { readonly documentation: string },
): TaggedLiteralArgType<AttributeCtx> {
  return {
    kind: 'taggedLiteral',
    label: `${tags[0] ?? 'tag'}\`...\``,
    tags,
    documentation: options.documentation,
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
        return notOk([
          leafDiagnostic(
            ctx,
            arg,
            describeTaggedLiteralFailure(canonical.reason),
            CANONICALIZATION_CODES[canonical.reason],
          ),
        ]);
      }
      return ok({ tag, body: canonical.body, span: nodePslSpan(literal.syntax, ctx.sourceFile) });
    },
  };
}
