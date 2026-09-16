export type TaggedLiteralCanonicalization =
  | { readonly ok: true; readonly body: string }
  | {
      readonly ok: false;
      readonly reason: 'interpolation' | 'nul' | 'too-large';
      readonly offset: number;
    };

export const TAGGED_LITERAL_MAX_BYTES = 65536;

const BLANK_LINE = /^[ \t]*$/;
const LEADING_INDENT = /^[ \t]*/;

/**
 * Turns the escape-resolved text of a tagged literal into its canonical body:
 * newlines become `\n`, a blank first and last line are dropped, common leading
 * whitespace is removed, internal blank lines become empty, and no trailing
 * newline is added. Fails on `${`, on a NUL character, or when the result is
 * larger than 65536 UTF-8 bytes.
 */
export function canonicalizeTaggedLiteralBody(resolved: string): TaggedLiteralCanonicalization {
  const interpolation = resolved.indexOf('${');
  if (interpolation !== -1) {
    return { ok: false, reason: 'interpolation', offset: interpolation };
  }
  const nul = resolved.indexOf('\0');
  if (nul !== -1) {
    return { ok: false, reason: 'nul', offset: nul };
  }
  const lines = resolved.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && BLANK_LINE.test(lines[0] ?? '')) {
    lines.shift();
  }
  if (lines.length > 0 && BLANK_LINE.test(lines.at(-1) ?? '')) {
    lines.pop();
  }
  const body = dedent(lines).join('\n');
  const excess = offsetWhereBytesExceed(body, TAGGED_LITERAL_MAX_BYTES);
  if (excess !== undefined) {
    return { ok: false, reason: 'too-large', offset: excess };
  }
  return { ok: true, body };
}

function dedent(lines: readonly string[]): string[] {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (BLANK_LINE.test(line)) continue;
    indent = Math.min(indent, LEADING_INDENT.exec(line)?.[0].length ?? 0);
  }
  if (!Number.isFinite(indent)) indent = 0;
  return lines.map((line) => (BLANK_LINE.test(line) ? '' : line.slice(indent)));
}

function offsetWhereBytesExceed(text: string, limit: number): number | undefined {
  let bytes = 0;
  let offset = 0;
  for (const char of text) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > limit) return offset;
    offset += char.length;
  }
  return undefined;
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
