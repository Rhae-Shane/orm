import { readdir, readFile, stat } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ControlPolicy } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { rangeToPslSpan } from '@internal/psl-parser';
import type { ParseDiagnostic, SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { applySqlSpecifierControlPolicy } from '@internal/sql-contract-ts/contract-builder';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { basename, extname, join } from 'pathe';
import { prisma7Diagnostic } from './diagnostics';
import { interpretPrisma7Documents, type Prisma7Document } from './interpreter';

export interface Prisma7SchemaOptions {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly defaultControlPolicy?: ControlPolicy;
  /**
   * The target's native enum vocabulary: the entity kind its pack registers
   * (Postgres: `native_enum`) and the type constructor path that references
   * one from a field (Postgres: `pg.enum`).
   */
  readonly nativeEnum: {
    readonly entityKind: string;
    readonly typeConstructor: readonly string[];
  };
}

function defaultOutputFromSchemaPath(schemaPath: string): string {
  const ext = extname(schemaPath);
  if (ext.length === 0) return join(schemaPath, 'contract.json');
  const base = schemaPath.slice(0, -ext.length);
  if (basename(base) === 'schema') {
    return `${base.slice(0, -'schema'.length)}contract.json`;
  }
  return `${base}.json`;
}

function mapParseDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
  sourceFile: SourceFile,
  sourceId: string,
): ContractSourceDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
}

async function listSchemaFiles(absolutePath: string, displayPath: string): Promise<string[]> {
  const info = await stat(absolutePath);
  if (!info.isDirectory()) return [displayPath];
  const entries = await readdir(absolutePath);
  return entries
    .filter((entry) => extname(entry) === '.prisma')
    .sort()
    .map((entry) => join(displayPath, entry));
}

export function prisma7Schema(schemaPath: string, options: Prisma7SchemaOptions): ContractConfig {
  return {
    source: {
      format: 'prisma7',
      inputs: [schemaPath],
      async load(context) {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'prisma7Schema: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
          );
        }
        let files: string[];
        try {
          files = await listSchemaFiles(absolutePath, schemaPath);
        } catch (error) {
          const message = String(error);
          return notOk({
            summary: `Failed to read Prisma 7 schema at "${schemaPath}"`,
            diagnostics: [
              prisma7Diagnostic('PRISMA7_SCHEMA_READ_FAILED', message, schemaPath, undefined),
            ],
            meta: { schemaPath, absolutePath, cause: message },
          });
        }
        const documents: Prisma7Document[] = [];
        const seedDiagnostics: ContractSourceDiagnostic[] = [];
        for (const file of files) {
          const absoluteFile =
            file === schemaPath ? absolutePath : join(absolutePath, basename(file));
          let schema: string;
          try {
            schema = await readFile(absoluteFile, 'utf-8');
          } catch (error) {
            const message = String(error);
            return notOk({
              summary: `Failed to read Prisma 7 schema at "${file}"`,
              diagnostics: [
                prisma7Diagnostic('PRISMA7_SCHEMA_READ_FAILED', message, file, undefined),
              ],
              meta: { schemaPath: file, absoluteSchemaPath: absoluteFile, cause: message },
            });
          }
          const { document, sourceFile, diagnostics } = parse(schema);
          seedDiagnostics.push(...mapParseDiagnostics(diagnostics, sourceFile, file));
          documents.push({ document, sourceFile, sourceId: file });
        }

        const interpreted = interpretPrisma7Documents({
          documents,
          seedDiagnostics,
          target: options.target,
          createNamespace: options.createNamespace,
          nativeEnum: options.nativeEnum,
          authoringContributions: context.authoringContributions,
          codecLookup: context.codecLookup,
          composedExtensions: context.composedExtensions,
        });
        if (!interpreted.ok) return interpreted;
        return ok(
          applySqlSpecifierControlPolicy(
            interpreted.value,
            options.defaultControlPolicy,
            options.createNamespace,
          ),
        );
      },
    },
    output: options.output ?? defaultOutputFromSchemaPath(schemaPath),
  };
}
