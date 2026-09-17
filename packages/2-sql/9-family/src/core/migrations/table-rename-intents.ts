import type { Contract } from '@internal/contract/types';
import type { StorageEntityRename } from '@internal/framework-components/control';
import {
  ForeignKey,
  type ForeignKeyReference,
  type ForeignKeyReferenceInput,
  isMaterializedSqlNamespace,
  type SqlNamespace,
  type SqlNamespaceBase,
  type SqlNamespaceEntries,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { SqlPlannerConflict } from './types';

export const TABLE_RENAME_UNMATCHED_CODE = 'MIGRATION.TABLE_RENAME_UNMATCHED';

/** A `--rename-table <from>=<to>` intent as the CLI parsed it. */
export type TableRenameIntent = StorageEntityRename;

/** An intent after both sides were matched against the contracts. */
export interface ResolvedTableRename {
  readonly namespaceId: string;
  readonly from: string;
  readonly to: string;
}

export interface ApplyTableRenameIntentsInput {
  readonly fromContract: Contract<SqlStorage> | null;
  readonly toContract: Contract<SqlStorage>;
  readonly intents: readonly TableRenameIntent[];
}

export interface AppliedTableRenames {
  /** The previous contract with every intent's table under its new name. */
  readonly contract: Contract<SqlStorage>;
  readonly renames: readonly ResolvedTableRename[];
}

type TableLookup =
  | { readonly kind: 'found'; readonly namespaceId: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous'; readonly namespaceIds: readonly string[] };

function coordinateLabel(coordinate: StorageEntityRename['from']): string {
  return coordinate.namespaceId === undefined
    ? coordinate.name
    : `${coordinate.namespaceId}.${coordinate.name}`;
}

function intentLabel(intent: TableRenameIntent): string {
  return `${coordinateLabel(intent.from)}=${coordinateLabel(intent.to)}`;
}

function namespacesDeclaring(contract: Contract<SqlStorage>, tableName: string): string[] {
  return Object.values(contract.storage.namespaces)
    .filter((namespace) => Object.hasOwn(namespace.entries.table ?? {}, tableName))
    .map((namespace) => namespace.id);
}

function lookupTable(
  contract: Contract<SqlStorage>,
  coordinate: StorageEntityRename['from'],
): TableLookup {
  if (coordinate.namespaceId !== undefined) {
    const namespace = contract.storage.namespaces[coordinate.namespaceId];
    return namespace !== undefined && Object.hasOwn(namespace.entries.table ?? {}, coordinate.name)
      ? { kind: 'found', namespaceId: coordinate.namespaceId }
      : { kind: 'missing' };
  }
  const namespaceIds = namespacesDeclaring(contract, coordinate.name);
  const [only] = namespaceIds;
  if (only !== undefined && namespaceIds.length === 1) return { kind: 'found', namespaceId: only };
  return namespaceIds.length === 0 ? { kind: 'missing' } : { kind: 'ambiguous', namespaceIds };
}

function unmatched(intent: TableRenameIntent, reason: string): SqlPlannerConflict {
  return {
    kind: 'tableRenameUnmatched',
    summary: `${TABLE_RENAME_UNMATCHED_CODE}: --rename-table "${intentLabel(intent)}" does not match the contracts: ${reason}.`,
    why: 'A rename intent must name a table of the previous contract as its old name and a table of the next contract as its new name, and the new name must not already exist in the previous contract. Check the spelling and the schema qualifier, or drop the flag if the table was not renamed.',
    meta: { code: TABLE_RENAME_UNMATCHED_CODE, from: intent.from.name, to: intent.to.name },
  };
}

function ambiguousReason(
  coordinate: StorageEntityRename['from'],
  namespaceIds: readonly string[],
): string {
  return `table "${coordinate.name}" is declared in more than one namespace (${namespaceIds.join(', ')}); qualify it as <namespace>.${coordinate.name}`;
}

function resolveIntent(
  intent: TableRenameIntent,
  fromContract: Contract<SqlStorage>,
  toContract: Contract<SqlStorage>,
): Result<ResolvedTableRename, SqlPlannerConflict> {
  const from = lookupTable(fromContract, intent.from);
  if (from.kind === 'ambiguous') {
    return notOk(unmatched(intent, ambiguousReason(intent.from, from.namespaceIds)));
  }
  if (from.kind === 'missing') {
    return notOk(
      unmatched(
        intent,
        `table "${coordinateLabel(intent.from)}" does not exist in the previous contract`,
      ),
    );
  }
  const namespaceId = from.namespaceId;
  if (intent.to.namespaceId !== undefined && intent.to.namespaceId !== namespaceId) {
    return notOk(
      unmatched(
        intent,
        `a rename cannot move table "${intent.from.name}" from namespace "${namespaceId}" to namespace "${intent.to.namespaceId}"`,
      ),
    );
  }
  const previousNamespace = fromContract.storage.namespaces[namespaceId];
  if (Object.hasOwn(previousNamespace?.entries.table ?? {}, intent.to.name)) {
    return notOk(
      unmatched(intent, `table "${intent.to.name}" already exists in the previous contract`),
    );
  }
  const nextNamespace = toContract.storage.namespaces[namespaceId];
  if (!Object.hasOwn(nextNamespace?.entries.table ?? {}, intent.to.name)) {
    return notOk(
      unmatched(intent, `table "${intent.to.name}" does not exist in the next contract`),
    );
  }
  return ok({ namespaceId, from: intent.from.name, to: intent.to.name });
}

function renamedReference(
  reference: ForeignKeyReference,
  rename: ResolvedTableRename,
): ForeignKeyReference | ForeignKeyReferenceInput {
  const local = reference.spaceId === undefined;
  if (
    !local ||
    reference.namespaceId !== rename.namespaceId ||
    reference.tableName !== rename.from
  ) {
    return reference;
  }
  return { ...reference, tableName: rename.to };
}

function renameForeignKeys(table: StorageTable, rename: ResolvedTableRename): StorageTable {
  const touched = table.foreignKeys.some(
    (fk) =>
      renamedReference(fk.source, rename) !== fk.source ||
      renamedReference(fk.target, rename) !== fk.target,
  );
  if (!touched) return table;
  return new StorageTable({
    ...table,
    foreignKeys: table.foreignKeys.map(
      (fk) =>
        new ForeignKey({
          ...fk,
          source: renamedReference(fk.source, rename),
          target: renamedReference(fk.target, rename),
        }),
    ),
  });
}

/**
 * The same namespace instance with only `entries` replaced: every own
 * property, including the non-enumerable `kind`, is carried over onto the
 * same prototype, so the target's namespace class (its `qualifyTable`,
 * `ddlSchemaName`, entity getters) keeps working on the copy. This is the
 * one place a frozen contract node is rebuilt without its constructor: the
 * constructors re-hydrate `entries` from raw input, which the already
 * hydrated entities here do not need.
 */
function withEntries(namespace: SqlNamespaceBase, entries: SqlNamespaceEntries): SqlNamespaceBase {
  const copy: SqlNamespaceBase = Object.create(Object.getPrototypeOf(namespace), {
    ...Object.getOwnPropertyDescriptors(namespace),
    entries: {
      value: Object.freeze(entries),
      enumerable: true,
      writable: false,
      configurable: false,
    },
  });
  return Object.freeze(copy);
}

function renameTablesInNamespace(
  namespace: SqlNamespace,
  renames: readonly ResolvedTableRename[],
): SqlNamespace {
  const own = renames.filter((rename) => rename.namespaceId === namespace.id);
  const tables = Object.entries(namespace.entries.table ?? {}).map(([name, table]) => {
    const renamedTo = own.find((rename) => rename.from === name)?.to;
    const withForeignKeys = renames.reduce(renameForeignKeys, table);
    return [renamedTo ?? name, withForeignKeys] as const;
  });
  const untouched = tables.every(([name, table]) => namespace.entries.table?.[name] === table);
  if (untouched) return namespace;
  if (!isMaterializedSqlNamespace(namespace)) {
    throw new InternalError(
      `applyTableRenameIntents: namespace "${namespace.id}" is not a materialized SQL namespace`,
    );
  }
  return withEntries(namespace, {
    ...namespace.entries,
    table: Object.fromEntries(tables),
  });
}

function renameTablesInContract(
  contract: Contract<SqlStorage>,
  renames: readonly ResolvedTableRename[],
): Contract<SqlStorage> {
  const namespaces = Object.fromEntries(
    Object.entries(contract.storage.namespaces).map(([id, namespace]) => [
      id,
      renameTablesInNamespace(namespace, renames),
    ]),
  );
  const materialized: Record<string, SqlNamespaceBase> = {};
  for (const [id, namespace] of Object.entries(namespaces)) {
    if (!isMaterializedSqlNamespace(namespace)) {
      throw new InternalError(
        `applyTableRenameIntents: namespace "${id}" is not a materialized SQL namespace`,
      );
    }
    materialized[id] = namespace;
  }
  return {
    ...contract,
    storage: new SqlStorage({
      storageHash: contract.storage.storageHash,
      ...(contract.storage.types === undefined ? {} : { types: contract.storage.types }),
      namespaces: materialized,
    }),
  };
}

/**
 * Applies operator-stated rename intents to the previous contract so the
 * ordinary diff sees each renamed table under its new name. Every intent is
 * matched first: its old name must exist in the previous contract (in
 * exactly one namespace when unqualified), its new name must not, and its
 * new name must exist in the next contract. One conflict per unmatched
 * intent; nothing is applied unless every intent matches.
 *
 * Foreign keys that name a renamed table on either side are retargeted so
 * the FK still pairs with the next contract's. Index, unique, check and
 * primary-key names are carried unchanged: the differ pairs those by hash or
 * by columns, and their renames are planned by the existing rename passes.
 */
export function applyTableRenameIntents(
  input: ApplyTableRenameIntentsInput,
): Result<AppliedTableRenames, readonly SqlPlannerConflict[]> {
  if (input.intents.length === 0) {
    if (input.fromContract === null) {
      throw new InternalError('applyTableRenameIntents: nothing to apply and no previous contract');
    }
    return ok({ contract: input.fromContract, renames: [] });
  }
  if (input.fromContract === null) {
    return notOk([
      {
        kind: 'unsupportedOperation',
        summary:
          '--rename-table needs a previous contract to apply the rename to, and this plan starts from an empty database.',
        why: 'A rename intent only makes sense between two contracts. Plan from the migration that created the table, or drop the flag.',
      },
    ]);
  }
  const fromContract = input.fromContract;
  const conflicts: SqlPlannerConflict[] = [];
  const renames: ResolvedTableRename[] = [];
  for (const intent of input.intents) {
    const resolved = resolveIntent(intent, fromContract, input.toContract);
    if (resolved.ok) renames.push(resolved.value);
    else conflicts.push(resolved.failure);
  }
  if (conflicts.length > 0) return notOk(conflicts);
  return ok({ contract: renameTablesInContract(fromContract, renames), renames });
}
