#!/usr/bin/env node
/**
 * Adds `@@map("<model name with its first letter lowered>")` to every PSL
 * `model` block that has no `@@map`, so a schema written before Prisma 8 made
 * model names verbatim keeps the table (or collection) names it already has.
 *
 * Usage:
 *   node scripts/codemods/add-model-map.mjs <file-or-glob> [...more]
 *
 * A model with `@@base(...)` and no `@@map` shares its base's storage, so it
 * is left alone: adding `@@map` there would split it into its own table or
 * collection.
 *
 * Files are rewritten in place; changed paths are printed. Running it twice is
 * a no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const MODEL_LINE = /^\s*model\s/;
const MODEL_START = /^(\s*)model\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\{)?(.*)$/;
const OPEN_BRACE_LINE = /^\s*\{\s*(\/\/.*)?$/;
const BLANK_OR_COMMENT = /^\s*(\/\/.*)?$/;
const BLOCK_CLOSE = /^\s*\}\s*$/;
const MAP_ATTRIBUTE = /^\s*@@map\s*\(/;
const BASE_ATTRIBUTE = /^\s*@@base\s*\(/;
const OWN_STORAGE_ATTRIBUTE = /@@(map|base)\s*\(/;

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function bodyIndent(lines, start, end, headerIndent) {
  for (let i = start; i < end; i += 1) {
    const match = /^(\s*)\S/.exec(lines[i]);
    if (match) return match[1];
  }
  return `${headerIndent}  `;
}

function stripCr(line) {
  return line.replace(/\r$/, '');
}

/**
 * Classifies the `model` line at `index`. Returns the header indent, the model
 * name, the index of the first body line, any body text that shares the
 * header line, and whether the whole block sits on this one line.
 */
function readModelStart(lines, index) {
  const match = MODEL_START.exec(stripCr(lines[index]));
  if (!match) return undefined;
  const [, indent, modelName, brace, rest] = match;
  if (brace === undefined) {
    if (!BLANK_OR_COMMENT.test(rest)) return undefined;
    const next = lines[index + 1];
    if (next === undefined || !OPEN_BRACE_LINE.test(stripCr(next))) return undefined;
    return { indent, modelName, bodyStart: index + 2, inlineBody: '', singleLine: false };
  }
  const closeAt = rest.lastIndexOf('}');
  if (closeAt !== -1 && /^\s*$/.test(rest.slice(closeAt + 1))) {
    return { indent, modelName, bodyStart: index + 1, inlineBody: rest, singleLine: true };
  }
  return {
    indent,
    modelName,
    bodyStart: index + 1,
    inlineBody: BLANK_OR_COMMENT.test(rest) ? '' : rest,
    singleLine: false,
  };
}

function addMapToSingleLineModel(line, modelName) {
  const raw = stripCr(line);
  const closeAt = raw.lastIndexOf('}');
  const body = raw.slice(0, closeAt);
  if (OWN_STORAGE_ATTRIBUTE.test(body)) return line;
  return `${body.trimEnd()} @@map("${lowerFirst(modelName)}") ${line.slice(closeAt)}`;
}

/** Thrown when a `model` line is written in a shape the codemod does not recognise. */
export class UnhandledModelError extends Error {
  constructor(lineNumbers) {
    super(`model block(s) not understood at line(s) ${lineNumbers.join(', ')}`);
    this.lineNumbers = lineNumbers;
  }
}

export function addModelMaps(source) {
  const newline = source.includes('\r\n') ? '\r' : '';
  const lines = source.split('\n');
  const out = [];
  const unhandled = [];
  let i = 0;
  while (i < lines.length) {
    if (!MODEL_LINE.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const start = readModelStart(lines, i);
    if (start === undefined) {
      unhandled.push(i + 1);
      out.push(lines[i]);
      i += 1;
      continue;
    }
    if (start.singleLine) {
      out.push(addMapToSingleLineModel(lines[i], start.modelName));
      i += 1;
      continue;
    }
    let close = start.bodyStart;
    while (close < lines.length && !BLOCK_CLOSE.test(lines[close])) close += 1;
    if (close >= lines.length) {
      unhandled.push(i + 1);
      out.push(...lines.slice(i));
      break;
    }
    const body = [start.inlineBody, ...lines.slice(start.bodyStart, close)];
    out.push(...lines.slice(i, close));
    if (!body.some((line) => MAP_ATTRIBUTE.test(line) || BASE_ATTRIBUTE.test(line))) {
      const indent = bodyIndent(lines, start.bodyStart, close, start.indent);
      out.push(`${indent}@@map("${lowerFirst(start.modelName)}")${newline}`);
    }
    out.push(lines[close]);
    i = close + 1;
  }
  if (unhandled.length > 0) throw new UnhandledModelError(unhandled);
  return out.join('\n');
}

async function expandPatterns(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for await (const match of glob(pattern)) files.add(match);
  }
  return [...files].sort();
}

async function main() {
  const patterns = argv.slice(2);
  if (patterns.length === 0) {
    stderr.write('usage: node scripts/codemods/add-model-map.mjs <file-or-glob> [...more]\n');
    exit(2);
  }
  const files = await expandPatterns(patterns);
  let failed = false;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    let after;
    try {
      after = addModelMaps(before);
    } catch (error) {
      if (!(error instanceof UnhandledModelError)) throw error;
      for (const line of error.lineNumbers)
        stderr.write(`${file}:${line}: model block not understood\n`);
      failed = true;
      continue;
    }
    if (after !== before) {
      writeFileSync(file, after);
      stdout.write(`${file}\n`);
    }
  }
  if (failed) exit(1);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main();
}
