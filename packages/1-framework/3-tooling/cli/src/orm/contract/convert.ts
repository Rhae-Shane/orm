import { existsSync } from 'node:fs';
import { printPsl as printPslFromAst } from '@internal/psl-printer';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import { createControlClient as createDefaultControlClient } from '../../control-api/client';
import { loadContractSource } from '../../control-api/operations/load-contract-source';
import type { ControlClient, ControlClientOptions } from '../../control-api/types';
import {
  CliStructuredError,
  errorContractConfigMissing,
  errorRuntime,
  errorUnexpected,
} from '../../utils/cli-errors';
import { closeQuietly } from '../../utils/command-helpers';
import { runCommandAction } from '../../utils/next-actions';
import { publishTextArtifact } from '../../utils/publish-text-artifact';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { inferredContractPathFor } from './paths';

interface ConvertDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly psl: { readonly path: string };
  readonly source: string;
  readonly timings: { readonly total: number };
}

/**
 * The routine that carries a converted contract onto the database Prisma 7
 * built: emit, plan a baseline, sign, then point the `db` ref at the baseline.
 */
const CUTOVER_ACTIONS: readonly NextAction[] = [
  runCommandAction('Emit the converted contract', '{bin} contract emit'),
  runCommandAction('Plan the baseline migration', '{bin} migration plan --name baseline'),
  runCommandAction('Sign the database', '{bin} db sign'),
  runCommandAction(
    'Point the db ref at the baseline migration',
    '{bin} migration ref set db <timestamp>_baseline',
  ),
];

function convertPresentations(document: ConvertDocument): Presentations {
  return {
    stdout: () => [],
    next: () => CUTOVER_ACTIONS,
    human: (): readonly Block[] => [
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Contract written to ' }, { text: document.psl.path, tone: 'identifier' }],
      },
    ],
    json: () => document,
  };
}

/** What `contract convert` uses of the control client; doubles implement just this. */
export type ConvertControlClient = Pick<
  ControlClient,
  'printPslContract' | 'getPslBlockDescriptors' | 'close'
>;

export interface ContractConvertCommandDeps {
  readonly createControlClient: (options: ControlClientOptions) => ConvertControlClient;
  readonly printPsl: typeof printPslFromAst;
}

function convertHeaderComment(schemaPath: string): string {
  return `// use prisma-8\n// Converted from ${schemaPath} by \`prisma contract convert\`.`;
}

export function createContractConvertCommand({
  createControlClient,
  printPsl,
}: ContractConvertCommandDeps) {
  return defineOrmCommand({
    help: {
      summary: 'Convert a Prisma 7 schema into a Prisma 8 PSL contract',
      description:
        'Reads the Prisma 7 schema the config names as the contract source and\n' +
        'writes the Prisma 8 PSL that produces the same contract. The command\n' +
        'stops at contract.prisma; switch the config to the written file, then\n' +
        'run `contract emit` and the rest of the cutover. An existing file at the\n' +
        'output path is overwritten, with a warning.',
      examples: [
        'contract convert',
        'contract convert --output ./src/prisma/contract.prisma',
        'contract convert --json',
      ],
    },
    args: {
      flags: {
        output: flag.string({
          brief: 'Write the converted PSL contract to the specified path',
          placeholder: 'path',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const contractConfig = ctx.config.contract;
      if (contractConfig?.source === undefined) {
        return notOk(
          normalizeError(
            errorContractConfigMissing({
              why: 'Config.contract.source is required for contract convert. Define it in your config: contract: prisma7Schema("./schema.prisma")',
            }),
          ),
        );
      }
      if (contractConfig.source.format !== 'prisma7') {
        return notOk(
          normalizeError(
            errorRuntime(
              'CONTRACT.CONVERT_SOURCE_NOT_PRISMA7',
              'contract convert applies only to a Prisma 7 source',
              {
                why: `The configured contract source has format "${contractConfig.source.format ?? 'unspecified'}", and there is nothing to convert: the contract is already authored the Prisma 8 way.`,
                fix: 'Point contract at prisma7Schema("./schema.prisma") to convert a Prisma 7 schema.',
                meta: { format: contractConfig.source.format ?? null },
              },
            ),
          ),
        );
      }

      const schemaInput = contractConfig.source.inputs?.[0];
      if (schemaInput === undefined) {
        return notOk(
          normalizeError(
            errorContractConfigMissing({
              why: 'The Prisma 7 contract source names no schema file, so there is nothing to convert.',
            }),
          ),
        );
      }
      const schemaPath = relative(ctx.cwd, schemaInput);

      const client = createControlClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        ...(ctx.config.driver === undefined ? {} : { driver: ctx.config.driver }),
        extensions: ctx.config.extensions ?? [],
      });

      let pslContent: string;
      try {
        const { stack, contract } = await loadContractSource({
          config: ctx.config,
          contractConfig,
        });
        const pslContractAst = client.printPslContract(contract);
        if (pslContractAst === undefined) {
          return notOk(
            normalizeError(
              errorRuntime(
                'CONTRACT.CONVERT_UNSUPPORTED',
                'contract convert is not supported for this target',
                {
                  why: 'The configured target does not implement the PslContractPrintCapable capability, so the loaded contract cannot be written as Prisma 8 PSL.',
                  fix: 'Use a target that supports contract conversion (Postgres today).',
                },
              ),
            ),
          );
        }
        pslContent = printPsl(pslContractAst, {
          pslBlockDescriptors: client.getPslBlockDescriptors(),
          codecLookup: stack.codecLookup,
          headerComment: convertHeaderComment(schemaPath),
        });
      } catch (error) {
        if (CliStructuredError.is(error)) {
          return notOk(normalizeError(error));
        }
        const message = error instanceof Error ? error.message : String(error);
        return notOk(
          normalizeError(
            errorUnexpected(message, {
              why: `Unexpected error during contract convert: ${message}`,
            }),
          ),
        );
      } finally {
        await closeQuietly(client);
      }

      const outputPath = inferredContractPathFor({
        config: ctx.config,
        cwd: ctx.cwd,
        output: args.flags.output,
      });
      const displayPath = relative(ctx.cwd, outputPath);
      if (existsSync(outputPath)) {
        ctx.report({
          kind: 'message',
          severity: 'warn',
          text: `Overwriting existing file: ${displayPath}`,
        });
      }
      await publishTextArtifact({
        path: outputPath,
        content: pslContent,
        publicationToken: String(process.hrtime.bigint()),
      });

      const document: ConvertDocument = {
        ok: true,
        summary: 'Contract converted successfully',
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        psl: { path: displayPath },
        source: schemaPath,
        timings: { total: Date.now() - startedAt },
      };

      return ok(ctx.present({ data: document }, convertPresentations(document)));
    },
  });
}

export const contractConvertCommand = createContractConvertCommand({
  createControlClient: createDefaultControlClient,
  printPsl: printPslFromAst,
});
