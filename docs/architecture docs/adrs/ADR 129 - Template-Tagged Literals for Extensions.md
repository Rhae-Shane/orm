# ADR 129 — Tagged literals carry raw SQL and other pack-owned text in PSL

## At a glance

A column default that Prisma cannot express as a literal or a named function is written as raw SQL inside a tagged literal:

```prisma
model Session {
  id        String   @id @default(sql`gen_random_uuid()`)
  expiresAt DateTime @default(sql"(now() + '00:03:00'::interval)")
  tags      String[] @default(sql`'{}'::text[]`)
  createdAt DateTime @default(now())
}
```

The tag (`sql`) names who owns the text. The fence (backticks or double quotes) holds the text. Prisma never interprets what is between the fences. The Postgres target reads the `sql` tag, checks the body is one expression, and stores it in the contract exactly as written:

```json
{ "default": { "kind": "function", "expression": "(now() + '00:03:00'::interval)" } }
```

The migration planner renders that expression verbatim as `DEFAULT ((now() + '00:03:00'::interval))`. The TypeScript builder has the same form, `` .default(sql`(now() + '00:03:00'::interval)`) ``, and produces the same contract.

## Decision

PSL gains one expression form for text that a pack owns and Prisma does not parse: a **tagged literal**, a qualified tag directly followed by a fenced body. The tag is registered by the pack that owns it. The body is canonicalized once by the framework, in the same way for PSL and for the TypeScript builder, and then handed to the owning pack, which decides what the literal lowers to.

The SQL family's `sql` tag is the first user. Every SQL target registers it, and a `` @default(sql`...`) `` lowers to the contract's ordinary function-kind column default, so the contract format does not change and every consumer of column defaults keeps working. Index expressions, check-constraint bodies, and row-level-security predicates continue to take plain strings; whether they move to tagged literals is a separate decision.

## Why a fence and not a string

Raw SQL is full of the characters a string literal fights with. `'{}'::text[]` has quotes, `E'\n'` has a backslash that must survive, and a view definition spans many lines. Written as `"..."`, each of those needs escaping, and the escaped form is what a reader sees. A fence changes the rules: a backtick fence keeps every character except three escapes, so SQL is written as SQL.

A string literal also says nothing about who reads it. `@default("gen_random_uuid()")` is a string default with those twenty characters as its value. `` @default(sql`gen_random_uuid()`) `` says the SQL family owns the text and Prisma passes it through. The tag makes that ownership visible in the schema and lets the parser refuse text no pack in the stack knows how to handle.

## Syntax

```
TaggedLiteral := QualifiedTag Fence
QualifiedTag  := Identifier ('.' Identifier)*
Fence         := TemplateLiteral | StringLiteral
```

- The fence follows the tag directly. Whitespace, a newline, or a comment between them is `PSL_TAGGED_LITERAL_FENCE_EXPECTED`.
- A `TemplateLiteral` is a backtick fence. It may span lines. Inside it, `` \` `` is a backtick, `\\` is one backslash, and `\$` is a dollar sign. Every other backslash sequence is kept as written, both characters, so `E'\n'` reaches the database unchanged. An unclosed backtick fence is `PSL_UNTERMINATED_TEMPLATE_LITERAL`, reported at the opening backtick.
- A `StringLiteral` fence is an ordinary PSL string literal with the ordinary PSL string escapes. It exists for a body that contains many backticks.
- A tagged literal is an expression and may appear wherever an expression may appear. An attribute accepts it only where its argument specification says so; everywhere else it is refused with that attribute's usual diagnostic.

## The canonical body

The body a pack receives is the same whichever fence was used and whichever language wrote it. After the fence's escapes are resolved, the framework's `canonicalizeTaggedLiteralBody` applies these steps in order:

1. `${` anywhere in the resolved text is `PSL_TAGGED_LITERAL_INTERPOLATION`. There is no escape for it. A tagged literal never interpolates.
2. A NUL character is `PSL_TAGGED_LITERAL_NUL`.
3. Line endings become `\n`.
4. A blank first line and a blank last line are dropped, so a body may open on the line after the fence and close on the line before it.
5. The common leading whitespace of the non-blank lines is removed. Tabs and spaces are counted as characters, not expanded.
6. Internal blank lines are kept, as empty lines.
7. No trailing newline is added.
8. A body over 65536 UTF-8 bytes is `PSL_TAGGED_LITERAL_TOO_LARGE`.

So these three write the same default:

```prisma
a DateTime @default(sql`(now() + '00:03:00'::interval)`)
b DateTime @default(sql"(now() + '00:03:00'::interval)")
c DateTime @default(sql`
  (now() + '00:03:00'::interval)
`)
```

The TypeScript `sql` template tag reads its raw template text, resolves the same three escapes, and runs the same function, so a TypeScript contract and a PSL contract that write the same SQL emit byte-identical contracts.

## Who owns a tag

A tag is known only when a pack in the contract's stack registers it. Registration lives beside the default-function registry each target already contributes: `ControlMutationDefaults.defaultLiteralTagRegistry`, a map from tag to an entry with the tag's usage text, its documentation for signature help, and a `lower` function. Stack assembly merges every contributor's map and refuses two contributors that register the same tag.

The naming rule:

- **The target may register an unprefixed tag.** `sql` is registered by Postgres and by SQLite, through one implementation the SQL family exports, so the two targets cannot drift. The target rather than the family registers it, because nobody has promised the tag will never vary by target.
- **Each target also registers its prefixed alias:** `pg.sql` on Postgres, `sqlite.sql` on SQLite. A schema that wants to say which database it is written for can.
- **Every other pack must prefix its tags** with its own namespace, so an extension's literals cannot collide with a target's or with each other's.

A tag no pack registered is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the tags that are registered. An attribute only offers the tagged-literal form at all when at least one tag is registered, so a stack with no SQL target never mentions it.

## What a tag lowers to

The registering pack's `lower` function receives the tag, the canonical body, and the literal's source span, and returns the same result shape a default function returns. For the `sql` tag that is a storage default, `{ kind: 'function', expression: <body> }`. The body is used as written: the framework does not rewrite it, the contract stores it, and the planner renders it inside `DEFAULT (...)`. The only check is the one the planners already apply before rendering any function default, run at authoring time so the diagnostic has a span: a body containing `;`, a SQL comment marker, `$$`, or the word `SELECT` is `PSL_INVALID_DEFAULT_SQL`. An empty body passes and the database reports the error.

Verification compares a raw default the way it compares any function default. Each target runs its own introspection parser over the authored expression and over the expression the database reports, then compares the two normalised forms, so a body the database reprints differently from how it was written still verifies clean.

## Consequences

- Raw SQL in a schema is visibly raw and visibly owned. A reader sees `sql` and knows Prisma passes the text through.
- One canonicalization serves both languages, so the choice between PSL and TypeScript never changes a contract.
- Nothing downstream of authoring changes. The contract shape, the planner, the verifier, and `contract infer` all work on the same function-kind default they already handled. `contract infer` prints a default it cannot name as `` @default(sql`...`) ``, so an adopted database round-trips.
- The formatter treats the fence token as opaque and never re-indents its interior. Highlighting the body as SQL is the editor's job, keyed by the tag.
- The 64 KiB limit and the refusal of `${` are fixed rules, not options. A body that needs `${` cannot be a tagged literal.

## Alternatives considered

- **Keep raw SQL as a plain string argument.** Rejected. Escaping makes SQL unreadable, a string carries no owner, and the parser cannot refuse text nobody handles.
- **Fenced code blocks (```` ``` ````) inside PSL.** Rejected. They complicate the tokenizer, have no natural owner, and offer nothing a tagged fence does not.
- **A single backtick fence only.** Rejected. A body that contains backticks would need escaping again, which is the problem the fence exists to remove.
- **Honour `\${` as an escaped interpolation marker.** Rejected. It would mean the interpolation check depends on which fence and which language wrote the body. No SQL needs those two characters.
- **The SQL family registers the unprefixed `sql` tag.** Rejected. It would assert that the tag can never differ between targets. Sharing the implementation through the family gives the same result without the assertion.
- **Store a raw default as a pack-owned envelope with a content hash and compare it by hash, the way index expressions and check constraints are compared by their content-addressed names.** Not adopted for column defaults. A column default has no name in the database catalog to carry a hash, so verification would still have to compare the database's reprint of the expression, and the contract shape would change for every consumer. The existing function-kind default already does the job.

## References

- ADR 104 — PSL extension namespacing and syntax
- ADR 112 — Target extension packs
- ADR 158 — Execution mutation defaults (the default-function registry the tag registry sits beside)
- ADR 234 and ADR 244 — Content-addressed names for indexes, policies, and check constraints (the comparison model raw defaults do not use)
