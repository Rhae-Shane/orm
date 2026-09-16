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

const MODEL_HEADER = /^(\s*)model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*(\/\/.*)?$/;
const SINGLE_LINE_MODEL = /^(\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{)(.*?)(\s*\}\s*)$/;
const UNHANDLED_MODEL =
  /^(\s*model\s+[A-Za-z_][A-Za-z0-9_]*\s*\{|model\s+[A-Za-z_][A-Za-z0-9_]*\s*)$/;
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

function addMapToSingleLineModel(line) {
  const match = SINGLE_LINE_MODEL.exec(line);
  if (!match) return line;
  const [, open, modelName, body, close] = match;
  if (OWN_STORAGE_ATTRIBUTE.test(body)) return line;
  return `${open}${body} @@map("${lowerFirst(modelName)}")${close}`;
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
    const header = MODEL_HEADER.exec(lines[i].replace(/\r$/, ''));
    if (!header) {
      const line = lines[i].replace(/\r$/, '');
      if (UNHANDLED_MODEL.test(line) && !SINGLE_LINE_MODEL.test(line)) unhandled.push(i + 1);
      out.push(addMapToSingleLineModel(lines[i]));
      i += 1;
      continue;
    }
    const [, headerIndent, modelName] = header;
    let close = i + 1;
    while (close < lines.length && !BLOCK_CLOSE.test(lines[close])) close += 1;
    if (close >= lines.length) {
      out.push(...lines.slice(i));
      break;
    }
    const body = lines.slice(i + 1, close);
    out.push(lines[i], ...body);
    if (!body.some((line) => MAP_ATTRIBUTE.test(line) || BASE_ATTRIBUTE.test(line))) {
      const indent = bodyIndent(lines, i + 1, close, headerIndent);
      out.push(`${indent}@@map("${lowerFirst(modelName)}")${newline}`);
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
