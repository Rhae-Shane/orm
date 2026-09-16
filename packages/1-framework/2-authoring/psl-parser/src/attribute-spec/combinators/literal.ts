import type { PslLiteral } from '@internal/framework-components/codec';
import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  BooleanLiteralExprAst,
  NumberLiteralExprAst,
  StringLiteralExprAst,
} from '../../syntax/ast/expressions';
import type { AttributeCtx, LiteralArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

/** A string, number, or boolean literal as the content a codec reads: quotes removed and escapes resolved for a string, the digits exactly as written for a number. */
export function literal(): LiteralArgType<AttributeCtx> {
  return {
    kind: 'literal',
    label: 'literal',
    parse: (arg, ctx): Result<PslLiteral, readonly PslDiagnostic[]> => {
      const text = StringLiteralExprAst.cast(arg.syntax)?.value();
      if (text !== undefined) return ok({ kind: 'string', text });
      const digits = NumberLiteralExprAst.cast(arg.syntax)?.token()?.text;
      if (digits !== undefined) return ok({ kind: 'number', text: digits });
      const flag = BooleanLiteralExprAst.cast(arg.syntax)?.value();
      if (flag !== undefined) return ok({ kind: 'boolean', text: flag ? 'true' : 'false' });
      return notOk([leafDiagnostic(ctx, arg, 'Expected a string, number, or boolean literal')]);
    },
  };
}
