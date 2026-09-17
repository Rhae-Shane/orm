import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { SqlIndexIR } from '@internal/sql-schema-ir/types';
import { issueNode } from './issue-planner';
import { CreateIndexCall, DropIndexCall, type SqliteOpFactoryCall } from './op-factory-call';

interface IndexFinding {
  readonly issue: SchemaDiffIssue;
  readonly index: SqlIndexIR;
  readonly tableName: string;
  readonly hash: string;
}

function indexFindings(
  issues: readonly SchemaDiffIssue[],
  renamedTables: ReadonlySet<string>,
  outcome: 'not-found' | 'not-expected',
): IndexFinding[] {
  return issues.flatMap((issue) => {
    const node = issueNode(issue);
    const tableName = issue.path[1];
    if (node === undefined || !SqlIndexIR.is(node) || tableName === undefined) return [];
    if (!renamedTables.has(tableName) || issueOutcome(issue) !== outcome) return [];
    const wire = parseWireName(node.name);
    return wire === undefined ? [] : [{ issue, index: node, tableName, hash: wire.hash }];
  });
}

/**
 * The index operations a table rename needs on SQLite. An index whose wire name derives from the table name keeps its old name through the rename, and SQLite cannot rename an index, so each old index that pairs with a new one by content hash on a renamed table is dropped and the new one created. Drops come first because SQLite compares index names without case, and a name that only changes case would otherwise collide. The paired issues are returned as consumed so the ordinary diff does not plan them again.
 */
export function pairRenamedTableIndexes(
  issues: readonly SchemaDiffIssue[],
  renamedTables: ReadonlySet<string>,
): {
  readonly calls: readonly SqliteOpFactoryCall[];
  readonly consumed: ReadonlySet<SchemaDiffIssue>;
} {
  const missing = indexFindings(issues, renamedTables, 'not-found');
  const pairs = indexFindings(issues, renamedTables, 'not-expected').flatMap((old) => {
    const replacement = missing.find(
      (candidate) =>
        candidate.tableName === old.tableName &&
        candidate.hash === old.hash &&
        candidate.index.name !== old.index.name,
    );
    if (replacement === undefined) return [];
    missing.splice(missing.indexOf(replacement), 1);
    return [{ old, replacement }];
  });
  return {
    calls: [
      ...pairs.map(({ old }) => new DropIndexCall(old.tableName, old.index.name)),
      ...pairs.map(
        ({ replacement }) =>
          new CreateIndexCall(
            replacement.tableName,
            replacement.index.name,
            replacement.index.columns ?? [],
          ),
      ),
    ],
    consumed: new Set(pairs.flatMap(({ old, replacement }) => [old.issue, replacement.issue])),
  };
}
