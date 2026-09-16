import { blindCast } from '@internal/utils/casts';

const PRISMA7_PACKAGE_CONFIG_SPECIFIER = '@prisma/prisma7/config';

/**
 * Points a Prisma 7 config at the Prisma 7 package's config entrypoint. Both
 * quote styles are rewritten; `found` is false when the file imports neither.
 */
export function rewritePrisma7ConfigImport(content: string): {
  readonly content: string;
  readonly found: boolean;
} {
  const rewritten = content.replace(
    /(['"])prisma\/config\1/g,
    (_match, quote: string) => `${quote}${PRISMA7_PACKAGE_CONFIG_SPECIFIER}${quote}`,
  );
  return { content: rewritten, found: rewritten !== content };
}

const SHELL_OPERATOR = /&&|\|\||;|\|/g;

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Wrappers whose next word, after any `NAME=value` assignments, is the command they run. */
const PREFIX_WRAPPERS: readonly (readonly string[])[] = [
  ['pnpm', 'exec'],
  ['pnpm', 'dlx'],
  ['pnpm'],
  ['yarn', 'exec'],
  ['yarn', 'dlx'],
  ['yarn'],
  ['bun', 'x'],
  ['bun'],
  ['bunx'],
  ['npx'],
  ['cross-env'],
];

/** Wrappers that take their own arguments and run the command after `--`. */
const SEPARATOR_WRAPPERS: readonly (readonly string[])[] = [
  ['dotenv'],
  ['dotenvx', 'run'],
  ['env-cmd'],
];

interface Word {
  readonly text: string;
  readonly end: number;
}

function wordsOf(script: string, start: number, end: number): Word[] {
  return [...script.slice(start, end).matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    end: start + match.index + match[0].length,
  }));
}

function commandsOf(script: string): Word[][] {
  const commands: Word[][] = [];
  let start = 0;
  for (const operator of script.matchAll(SHELL_OPERATOR)) {
    commands.push(wordsOf(script, start, operator.index));
    start = operator.index + operator[0].length;
  }
  commands.push(wordsOf(script, start, script.length));
  return commands;
}

function wrapperAt(
  words: readonly Word[],
  at: number,
  wrappers: readonly (readonly string[])[],
): readonly string[] | undefined {
  return wrappers.find((wrapper) =>
    wrapper.every((part, offset) => words[at + offset]?.text === part),
  );
}

/**
 * The `prisma` word that runs as the command starting at `at`: skips
 * `NAME=value` assignments, then either is `prisma` or unwraps a recognised
 * wrapper and looks again at the command it runs.
 */
function prismaCommandWord(words: readonly Word[], at: number): Word | undefined {
  let index = at;
  while (ENV_ASSIGNMENT.test(words[index]?.text ?? '')) {
    index += 1;
  }
  const word = words[index];
  if (word?.text === 'prisma') {
    return word;
  }
  const prefix = wrapperAt(words, index, PREFIX_WRAPPERS);
  if (prefix !== undefined) {
    return prismaCommandWord(words, index + prefix.length);
  }
  const separated = wrapperAt(words, index, SEPARATOR_WRAPPERS);
  if (separated === undefined) {
    return undefined;
  }
  const separator = words.findIndex(
    (candidate, position) => position >= index + separated.length && candidate.text === '--',
  );
  return separator === -1 ? undefined : prismaCommandWord(words, separator + 1);
}

/**
 * Rewrites `prisma` to `prisma7` wherever it is the command a script runs: at
 * the start of the script or after `&&`, `||`, `;`, or `|`, behind any
 * `NAME=value` assignments and recognised wrappers. `prisma` as an argument,
 * and words that only start with it (`prisma@7`, `prisma-erd`), are left alone.
 */
export function rewritePrismaBinary(script: string): string {
  const ends = commandsOf(script)
    .map((words) => prismaCommandWord(words, 0)?.end)
    .filter((end) => end !== undefined);
  return ends.reduceRight(
    (rewritten, end) => `${rewritten.slice(0, end)}7${rewritten.slice(end)}`,
    script,
  );
}

/**
 * Rewrites every `package.json` script that invokes the `prisma` binary to
 * invoke `prisma7`, except the scripts init itself adds, which keep the
 * Prisma 8 binary. Returns `null` when no script changes.
 */
export function rewritePrismaScripts(
  manifest: string,
  keepNames: readonly string[],
): { readonly content: string; readonly names: readonly string[] } | null {
  const parsed = blindCast<
    Record<string, unknown>,
    'JSON.parse returns unknown; package.json is a JSON object so its top level is a string-keyed record'
  >(JSON.parse(manifest));
  const scripts = parsed['scripts'];
  if (typeof scripts !== 'object' || scripts === null) {
    return null;
  }
  const kept = new Set(keepNames);
  const names: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [name, command] of Object.entries(scripts)) {
    const rewritten =
      typeof command === 'string' && !kept.has(name) ? rewritePrismaBinary(command) : command;
    if (rewritten !== command) {
      names.push(name);
    }
    next[name] = rewritten;
  }
  if (names.length === 0) {
    return null;
  }
  parsed['scripts'] = next;
  const trailingNewline = manifest.endsWith('\n') ? '\n' : '';
  return { content: `${JSON.stringify(parsed, null, 2)}${trailingNewline}`, names };
}
