# ADR 129 — Template-Tagged Literals for Extensions

## Context

Packs need a way to accept rich, multi-line, domain-specific text inside PSL without expanding the core grammar for every feature. Examples include SQL view definitions, boolean predicates for partial indexes, RLS policy expressions, and specialized functions/operators. Prior ideas like fenced code blocks complicate parsing and determinism.

## Decision

Adopt template-tagged string literals as the single mechanism for extension-owned textual payloads.

- Syntax: a qualified tag followed by a backtick literal, e.g. `pg.sql` or `pg.predicate`
- No interpolation allowed
- Core performs canonicalization and routes the literal to the owning pack
- Packs validate and normalize content deterministically and return a JSON payload embedded in the contract under `ext`

## Syntax

Informal grammar:

```
TaggedLiteral := QualifiedIdent  TemplateLiteral

QualifiedIdent := Identifier ('.' Identifier)*

TemplateLiteral := '`' { any char except unescaped '`' and the sequence '${' } '`'
```

Rules:

- Tag must be a qualified identifier `<pack>[.<flavor>]`
- `${` is a hard error unless escaped as `\${}`
- Backticks inside the body must be escaped as ``\```

## Canonicalization

Core canonicalizes all tagged literals before invoking packs:

- Normalize line endings to `\n`
- If the first line is blank, drop it
- If the last line is blank, drop it
- Dedent by the smallest common leading whitespace across all non-blank lines
- Preserve internal blank lines
- No trailing newline added
- Reject `${` (unescaped) and NUL (`\0`) characters
- Enforce a configurable byte limit, default 64 KiB

## AST node

```ts
type TaggedLiteralNode = {
  kind: 'TaggedLiteral'
  tag: string           // e.g. 'pg.sql', 'pg.predicate'
  canonicalBody: string // canonicalized form
  rawBody: string       // as authored, for diagnostics only
  span: SourceSpan
}
```

## Contract encoding

Encoded under an `ext` wrapper owned by the pack:

```json
{
  "ext": {
    "pack": "pg",
    "tag": "predicate",
    "body": "(status = 'active') AND (created_at > now() - interval '7 days')",
    "bodyHash": "…"
  }
}
```

Notes:

- `body` is the canonical form
- `bodyHash` participates in diffing and planner decisions
- Packs must not rely on `rawBody`

## Validation lifecycle

- Parse time: core enforces syntax, no interpolation, canonicalizes, and builds `TaggedLiteralNode`
- Emit time: core routes node to the owning pack by tag prefix
- Pack validation: pack validates semantics (e.g., “must be a boolean SQL expression”) and returns a deterministic JSON payload
- Contract build: payload is embedded under an `ext` property or normalized into a richer structured field as defined by the pack

## Lints & guardrails

- `extensions.noInterpolation`: error on `${`
- `extensions.maxLiteralBytes`: default 64 KiB
- Optional context lints provided by packs, e.g. `extensions.pg.forbidSemicolonInExpr`, `extensions.pg.disallowDDLInPredicate`

## Editor integration

- Language injection guided by the tag (e.g., `pg.sql`, `pg.predicate`)
- Formatters must not modify literal interiors; canonicalization is owned by the emitter
- Diagnostics should point to the span of the literal; suggestions remain outside the literal body

## Consequences

- Deterministic, pack-owned semantics without growing core grammar
- Precise error spans and simple, stable diffs via `bodyHash`
- Consistent contract encoding that agents and tools can reason about

## Out of scope

- Executing or interpreting literal bodies in core
- Allowing interpolation or environment-dependent evaluation

## Amendment — column defaults

Added when `@default(dbgenerated("..."))` was replaced by a tagged literal for raw SQL column defaults. This amendment records what was built; where it differs from the sections above, this amendment applies to column defaults.

- **Two fences.** A tagged literal is `tag` followed directly by either a backtick fence, `` sql`gen_random_uuid()` ``, or a double-quote fence, `sql"(now() + '00:03:00'::interval)"`. The quote fence exists for a body with many backticks. Inside a backtick fence, `` \` `` is a backtick, `\\` is one backslash, and every other backslash sequence is kept as written, so `E'\n'` survives. Inside a quote fence the ordinary PSL string escapes apply and backticks need no escaping. No whitespace, newline, or comment may separate the tag from the fence (`PSL_TAGGED_LITERAL_FENCE_EXPECTED`).
- **One canonicalization for both fences and both languages.** After escape resolution, `canonicalizeTaggedLiteralBody` in `@internal/framework-components/control` normalizes line endings, drops a blank first and last line, removes the common leading whitespace, keeps internal blank lines empty, adds no trailing newline, and refuses `${` (`PSL_TAGGED_LITERAL_INTERPOLATION`), NUL (`PSL_TAGGED_LITERAL_NUL`), and a body over 65536 bytes (`PSL_TAGGED_LITERAL_TOO_LARGE`). The same function canonicalizes the TypeScript `sql` template tag's cooked string. Two literals with different fences and the same canonical body are the same default.
- **`\${` is not honoured.** The `${` check runs on the escape-resolved text, and `\$` resolves to `$`, so `\${` still fails; the grammar section's "unless escaped" rule does not apply to column defaults. A body that needs `${` cannot be a tagged literal in PSL, and a cooked TypeScript template literal rejects it the same way, so both languages agree.
- **Tags are registered by targets.** A tag is a qualified identifier and is known only when a pack in the contract's stack registers it in `ControlMutationDefaults.defaultLiteralTagRegistry`. Every SQL target registers the unprefixed `sql` through one implementation the SQL family exports (`sqlDefaultLiteralTagEntry`), plus its own prefixed alias: `pg.sql` on Postgres, `sqlite.sql` on SQLite. Any other extension must prefix its tags. An unknown tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, listing the known tags; two contributors registering the same tag is an assembly error.
- **The node as built.** `TaggedLiteralExprAst` has `tag()`, `fence()` (`'backtick' | 'quote'`), `rawBody()` (between the fences, escapes unresolved), `body()` (the canonical body, `undefined` when canonicalization fails), and the node's span. The formatter never touches the token's text.
- **Contract encoding.** A column default lowers to `{ kind: 'function', expression: <canonical body> }`, the shape `dbgenerated("...")` produced, not the `ext` envelope above. Whether raw SQL defaults should later become a content-addressed payload is recorded in the project's deferred list.
- **Only `@default` accepts the node today.** Every other attribute rejects it through its ordinary combinator diagnostic. The body is checked once at authoring time with `checkSqlDefaultBody` (`PSL_INVALID_DEFAULT_SQL`), the same rule the migration planners apply at DDL time.

## References

- ADR 104 — PSL extension namespacing & syntax
- ADR 105 — Contract extension encoding
- ADR 106 — Canonicalization for extensions
- ADR 112 — Target Extension Packs
- ADR 115 — Extension guardrails & EXPLAIN policies


