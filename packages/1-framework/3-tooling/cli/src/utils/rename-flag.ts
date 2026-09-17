import { CliStructuredError } from '@internal/errors/control';
import type {
  StorageEntityRename,
  StorageEntityRenameCoordinate,
} from '@internal/framework-components/control';
import { notOk, ok, type Result } from '@internal/utils/result';

const GRAMMAR = '<from>=<to>, each side optionally qualified as <namespace>.<name>';

function invalid(value: string, reason: string): CliStructuredError {
  return new CliStructuredError(
    'CLI.INVALID_RENAME_FLAG',
    `Invalid --rename value "${value}": ${reason}.`,
    {
      why: `--rename names the storage a model maps to and its new name, as ${GRAMMAR}.`,
      fix: `Write the flag as --rename ${GRAMMAR}, once per rename.`,
      meta: { value },
    },
  );
}

function parseCoordinate(
  value: string,
  side: string,
): Result<StorageEntityRenameCoordinate, CliStructuredError> {
  const dot = side.indexOf('.');
  if (dot === -1) {
    return side.length === 0 ? notOk(invalid(value, 'a name is missing')) : ok({ name: side });
  }
  const namespaceId = side.slice(0, dot);
  const name = side.slice(dot + 1);
  if (namespaceId.length === 0) return notOk(invalid(value, 'the namespace qualifier is empty'));
  if (name.length === 0) return notOk(invalid(value, `no name follows "${namespaceId}."`));
  return ok({ namespaceId, name });
}

function coordinateKey(coordinate: StorageEntityRenameCoordinate): string {
  return `${coordinate.namespaceId ?? ''}.${coordinate.name}`;
}

function coordinateLabel(coordinate: StorageEntityRenameCoordinate): string {
  return coordinate.namespaceId === undefined
    ? coordinate.name
    : `${coordinate.namespaceId}.${coordinate.name}`;
}

/**
 * Parses every `--rename <from>=<to>` value the operator gave, in the order given. A malformed value, a value whose two sides are the same, a value whose sides name different namespaces, and two values that share an old or a new name are each refused with `CLI.INVALID_RENAME_FLAG`.
 */
export function parseRenameFlags(
  values: readonly string[] | undefined,
): Result<readonly StorageEntityRename[], CliStructuredError> {
  const renames: StorageEntityRename[] = [];
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim();
    const parts = value.split('=');
    if (parts.length !== 2) {
      return notOk(
        invalid(
          value,
          parts.length < 2 ? 'expected one "=" between the two names' : 'expected exactly one "="',
        ),
      );
    }
    const [left = '', right = ''] = parts.map((part) => part.trim());
    const from = parseCoordinate(value, left);
    if (!from.ok) return from;
    const to = parseCoordinate(value, right);
    if (!to.ok) return to;
    if (
      from.value.namespaceId !== undefined &&
      to.value.namespaceId !== undefined &&
      from.value.namespaceId !== to.value.namespaceId
    ) {
      return notOk(
        invalid(
          value,
          `a rename cannot move "${coordinateLabel(from.value)}" to namespace "${to.value.namespaceId}"`,
        ),
      );
    }
    const fromKey = coordinateKey(from.value);
    const toKey = coordinateKey(to.value);
    if (fromKey === toKey) return notOk(invalid(value, 'the old and new names are the same'));
    if (seenFrom.has(fromKey)) {
      return notOk(invalid(value, `"${coordinateLabel(from.value)}" is renamed more than once`));
    }
    if (seenTo.has(toKey)) {
      return notOk(invalid(value, `more than one value renames to "${coordinateLabel(to.value)}"`));
    }
    seenFrom.add(fromKey);
    seenTo.add(toKey);
    renames.push({ from: from.value, to: to.value });
  }
  return ok(renames);
}
