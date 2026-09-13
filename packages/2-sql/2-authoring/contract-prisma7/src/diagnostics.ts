import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/psl-parser';

export type Prisma7DiagnosticCode =
  | 'PRISMA7_PROVIDER_MISMATCH'
  | 'PRISMA7_RELATION_MODE_UNSUPPORTED'
  | 'PRISMA7_VIEW_UNSUPPORTED'
  | 'PRISMA7_UNSUPPORTED_TYPE'
  | 'PRISMA7_NATIVE_TYPE_UNSUPPORTED'
  | 'PRISMA7_ENUM_NAMESPACE_MISMATCH'
  | 'PRISMA7_RELATION_UNRESOLVED'
  | 'PRISMA7_JUNCTION_ID_UNSUPPORTED'
  | 'PRISMA7_UNKNOWN_ATTRIBUTE'
  | 'PRISMA7_SCHEMA_READ_FAILED';

export function prisma7Diagnostic(
  code: Prisma7DiagnosticCode,
  message: string,
  sourceId: string,
  span: PslSpan | undefined,
): ContractSourceDiagnostic {
  return { code, message, sourceId, ...(span !== undefined ? { span } : {}) };
}
