import type { DiffableNode } from '@internal/framework-components/control';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import {
  defaultForeignKeyName,
  defaultPrimaryKeyName,
  defaultUniqueName,
} from './default-constraint-names';
import { RenameConstraintCall } from './op-factory-call';

export interface TableRenameConstraintInput {
  readonly schemaName: string;
  readonly from: string;
  readonly to: string;
  /** The renamed table as the previous contract describes it once every stated rename is applied. */
  readonly previous: PostgresTableSchemaNode;
  readonly next: PostgresTableSchemaNode;
}

/** The constraint of the next table the diff pairs with `node` and finds unchanged, as the diff compares them. */
function unchangedIn<TNode extends DiffableNode>(
  node: TNode,
  nextNodes: readonly TNode[],
): TNode | undefined {
  return nextNodes.find((next) => next.id === node.id && next.isEqualTo(node));
}

/**
 * The constraint renames that follow a table rename. A primary key, unique constraint or foreign key the previous contract left unnamed carries a name the planner derived from the old table name. When the next contract keeps the same constraint, it is renamed to the name the next contract gives it explicitly, or otherwise to the name the planner now derives from the new table name. When the constraint changed, it is renamed to the derived name, which is the name the diff's drop of it uses. A constraint the previous contract named keeps its name. Indexes and checks are not handled here: their wire names pair by content hash in the ordinary rename passes.
 */
export function constraintRenamesForTableRename(
  input: TableRenameConstraintInput,
): readonly RenameConstraintCall[] {
  const { schemaName, from, to, previous, next } = input;
  const rename = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    oldName: string,
    unchanged: { readonly name?: string } | undefined,
    derivedName: string,
  ): readonly RenameConstraintCall[] => {
    const newName = unchanged?.name ?? derivedName;
    return oldName === newName
      ? []
      : [new RenameConstraintCall(schemaName, to, kind, oldName, newName)];
  };

  const primaryKey =
    previous.primaryKey !== undefined && previous.primaryKey.name === undefined
      ? rename(
          'primaryKey',
          defaultPrimaryKeyName(from),
          unchangedIn(previous.primaryKey, next.primaryKey === undefined ? [] : [next.primaryKey]),
          defaultPrimaryKeyName(to),
        )
      : [];

  const uniques = previous.uniques
    .filter((unique) => unique.name === undefined)
    .flatMap((unique) =>
      rename(
        'unique',
        defaultUniqueName(from, unique.columns),
        unchangedIn(unique, next.uniques),
        defaultUniqueName(to, unique.columns),
      ),
    );

  const foreignKeys = previous.foreignKeys
    .filter((fk) => fk.name === undefined)
    .flatMap((fk) =>
      rename(
        'foreignKey',
        defaultForeignKeyName(from, fk.columns),
        unchangedIn(fk, next.foreignKeys),
        defaultForeignKeyName(to, fk.columns),
      ),
    );

  return [...primaryKey, ...uniques, ...foreignKeys];
}
