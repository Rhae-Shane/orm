import type { ControlPolicy } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';

export type PostgresFunctionVolatility = 'VOLATILE' | 'STABLE' | 'IMMUTABLE';

export interface PostgresFunctionInput {
  /** Postgres function name (`CREATE FUNCTION <functionName> …`). */
  readonly functionName: string;
  /** Opaque argument list text, e.g. `size int DEFAULT 16`. */
  readonly signature: string;
  /** Opaque return type text, e.g. `text`. */
  readonly returns: string;
  /** Opaque function body (the part inside `AS $tag$ … $tag$`). */
  readonly body: string;
  /** Defaults to `plpgsql`. */
  readonly language?: string;
  /** Defaults to `STABLE`. */
  readonly volatility?: PostgresFunctionVolatility;
  readonly control?: ControlPolicy;
}

/**
 * Postgres contract-IR class for a user-defined SQL function.
 *
 * Authored and serialized into `contract.json` under
 * `storage.namespaces[ns].entries.function[<physicalName>]`. Schema-diff uses
 * {@link PostgresFunctionSchemaNode}; this class is not a DiffableNode.
 *
 * MVP limits: opaque `signature`/`body` (not validated), one name per namespace
 * (no overloads), create/drop only (no in-place replace).
 */
export class PostgresFunction extends SqlNode {
  static is(node: unknown): node is PostgresFunction {
    return (
      typeof node === 'object' &&
      node !== null &&
      'kind' in node &&
      node.kind === 'postgres-function'
    );
  }

  override readonly kind = 'postgres-function' as const;
  readonly functionName: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language: string;
  readonly volatility: PostgresFunctionVolatility;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresFunctionInput) {
    super();
    this.functionName = input.functionName;
    this.signature = input.signature;
    this.returns = input.returns;
    this.body = input.body;
    this.language = input.language ?? 'plpgsql';
    this.volatility = input.volatility ?? 'STABLE';
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}
