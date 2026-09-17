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
 * The constraint renames that follow a table rename. A primary key, unique constraint or foreign key the previous contract left unnamed carries a name the planner derived from the old table name, and every later plan derives it from the new one, so it is renamed to match. A constraint the previous contract named keeps its name, and so does one the next contract names explicitly. Indexes and checks are not handled here: their wire names pair by content hash in the ordinary rename passes.
 */
export function constraintRenamesForTableRename(
  input: TableRenameConstraintInput,
): readonly RenameConstraintCall[] {
  const { schemaName, from, to, previous, next } = input;
  const rename = (
    kind: 'primaryKey' | 'unique' | 'foreignKey',
    oldName: string,
    newName: string,
  ): RenameConstraintCall => new RenameConstraintCall(schemaName, to, kind, oldName, newName);

  const primaryKey =
    previous.primaryKey !== undefined &&
    previous.primaryKey.name === undefined &&
    next.primaryKey?.name === undefined
      ? [rename('primaryKey', defaultPrimaryKeyName(from), defaultPrimaryKeyName(to))]
      : [];

  const uniques = previous.uniques
    .filter(
      (unique) =>
        unique.name === undefined &&
        next.uniques.find((candidate) => sameColumns(candidate.columns, unique.columns))?.name ===
          undefined,
    )
    .map((unique) =>
      rename(
        'unique',
        defaultUniqueName(from, unique.columns),
        defaultUniqueName(to, unique.columns),
      ),
    );

  const foreignKeys = previous.foreignKeys
    .filter(
      (fk) =>
        fk.name === undefined &&
        next.foreignKeys.find((candidate) =>
          sameColumns(candidate.source.columns, fk.source.columns),
        )?.name === undefined,
    )
    .map((fk) =>
      rename(
        'foreignKey',
        defaultForeignKeyName(from, fk.source.columns),
        defaultForeignKeyName(to, fk.source.columns),
      ),
    );

  return [...primaryKey, ...uniques, ...foreignKeys];
}
