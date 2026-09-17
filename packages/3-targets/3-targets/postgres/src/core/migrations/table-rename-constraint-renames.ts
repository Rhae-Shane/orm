import type { StorageTable } from '@internal/sql-contract/types';
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
  readonly previous: StorageTable;
  readonly next: StorageTable;
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

/**
 * The constraint renames that follow a table rename. A primary key, unique constraint or foreign key the previous contract left unnamed carries a name the planner derived from the old table name. It is renamed to the name the next contract gives it explicitly, or otherwise to the name the planner now derives from the new table name. A constraint the previous contract named keeps its name. Indexes and checks are not handled here: their wire names pair by content hash in the ordinary rename passes.
 */
export function constraintRenamesForTableRename(
  input: TableRenameConstraintInput,
): readonly RenameConstraintCall[] {
  const { schemaName, from, to, previous, next } = input;
  const renameIfChanged = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    oldName: string,
    newName: string,
  ): readonly RenameConstraintCall[] =>
    oldName === newName ? [] : [new RenameConstraintCall(schemaName, to, kind, oldName, newName)];

  const primaryKey =
    previous.primaryKey !== undefined && previous.primaryKey.name === undefined
      ? renameIfChanged(
          'primaryKey',
          defaultPrimaryKeyName(from),
          next.primaryKey?.name ?? defaultPrimaryKeyName(to),
        )
      : [];

  const uniques = previous.uniques
    .filter((unique) => unique.name === undefined)
    .flatMap((unique) =>
      renameIfChanged(
        'unique',
        defaultUniqueName(from, unique.columns),
        next.uniques.find((candidate) => sameColumns(candidate.columns, unique.columns))?.name ??
          defaultUniqueName(to, unique.columns),
      ),
    );

  const foreignKeys = previous.foreignKeys
    .filter((fk) => fk.name === undefined)
    .flatMap((fk) =>
      renameIfChanged(
        'foreignKey',
        defaultForeignKeyName(from, fk.source.columns),
        next.foreignKeys.find((candidate) =>
          sameColumns(candidate.source.columns, fk.source.columns),
        )?.name ?? defaultForeignKeyName(to, fk.source.columns),
      ),
    );

  return [...primaryKey, ...uniques, ...foreignKeys];
}
