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

const MODEL_HEADER = /^(\s*)model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/;
const SINGLE_LINE_MODEL = /^(\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{)(.*?)(\s*\}\s*)$/;
const BLOCK_CLOSE = /^\s*\}\s*$/;
const MAP_ATTRIBUTE = /^\s*@@map\(/;
const BASE_ATTRIBUTE = /^\s*@@base\(/;

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
  if (/@@map\(|@@base\(/.test(body)) return line;
  return `${open}${body} @@map("${lowerFirst(modelName)}")${close}`;
}

export function addModelMaps(source) {
  const lines = source.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const header = MODEL_HEADER.exec(lines[i]);
    if (!header) {
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
      out.push(`${indent}@@map("${lowerFirst(modelName)}")`);
    }
    out.push(lines[close]);
    i = close + 1;
  }
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
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const after = addModelMaps(before);
    if (after !== before) {
      writeFileSync(file, after);
      stdout.write(`${file}\n`);
    }
  }
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main();
}
