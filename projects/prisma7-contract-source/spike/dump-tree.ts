import { readFileSync } from 'node:fs';
import { parse } from '../../../packages/1-framework/2-authoring/psl-parser/src/parse';
import type {
  SyntaxNode,
  SyntaxToken,
} from '../../../packages/1-framework/2-authoring/psl-parser/src/syntax/red';

const src = readFileSync(new URL('./schema.prisma', import.meta.url), 'utf8');
const r = parse(src);

function dump(node: SyntaxNode | SyntaxToken, depth = 0, max = 4): void {
  if (depth > max) return;
  if (node instanceof Object && 'text' in node) {
    if (/^\s*$/.test(node.text)) return;
    console.log(`${'  '.repeat(depth)}${node.kind} ${JSON.stringify(node.text)}`);
    return;
  }
  console.log(`${'  '.repeat(depth)}${node.kind}`);
  for (const child of node.children()) dump(child, depth + 1, max);
}

for (const d of r.document.declarations()) {
  console.log('==', d.constructor.name);
  dump(d.syntax, 1, 4);
}
