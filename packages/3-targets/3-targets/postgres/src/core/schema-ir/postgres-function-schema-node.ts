import type { ControlPolicy } from '@internal/contract/types';
import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import type { PostgresFunctionVolatility } from '../postgres-function';
import { PostgresSchemaNodeKind } from './schema-node-kinds';

export interface PostgresFunctionSchemaNodeInput {
  readonly functionName: string;
  readonly namespaceId: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language: string;
  readonly volatility: PostgresFunctionVolatility;
  readonly control?: ControlPolicy;
}

/**
 * Schema-diff leaf for a managed Postgres function.
 *
 * **MVP identity is name-only** (`function:<functionName>` within a namespace).
 * Postgres overloads (`foo(int)` vs `foo(text)`) are unsupported: the schema
 * rejects two entities that share a physical `functionName`. Equality compares
 * every authored field except `control`. The opaque `signature` is not part of
 * `id` because the MVP cannot normalize Postgres argument-list spelling.
 */
export class PostgresFunctionSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = PostgresSchemaNodeKind.function;

  readonly functionName: string;
  readonly namespaceId: string;
  readonly signature: string;
  readonly returns: string;
  readonly body: string;
  readonly language: string;
  readonly volatility: PostgresFunctionVolatility;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresFunctionSchemaNodeInput) {
    super();
    this.functionName = input.functionName;
    this.namespaceId = input.namespaceId;
    this.signature = input.signature;
    this.returns = input.returns;
    this.body = input.body;
    this.language = input.language;
    this.volatility = input.volatility;
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }

  get id(): string {
    return `function:${this.functionName}`;
  }

  children(): readonly DiffableNode[] {
    return [];
  }

  isEqualTo(other: DiffableNode): boolean {
    const node = blindCast<
      SqlSchemaIRNode,
      'every diff-tree node the differ pairs is a SqlSchemaIRNode; the guard rejects non-function kinds'
    >(other);
    PostgresFunctionSchemaNode.assert(node);
    return (
      this.functionName === node.functionName &&
      this.signature === node.signature &&
      this.returns === node.returns &&
      this.body === node.body &&
      this.language === node.language &&
      this.volatility === node.volatility
    );
  }

  static is(node: SqlSchemaIRNode): node is PostgresFunctionSchemaNode {
    return node.nodeKind === PostgresSchemaNodeKind.function;
  }

  static assert(node: SqlSchemaIRNode): asserts node is PostgresFunctionSchemaNode {
    assertNode(node, 'PostgresFunctionSchemaNode', PostgresFunctionSchemaNode.is);
  }
}
