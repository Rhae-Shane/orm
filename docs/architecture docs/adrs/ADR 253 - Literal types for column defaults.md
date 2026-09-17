# ADR 253 — Literal types for column defaults

Status: **Proposed**

## Decision

Every literal column default has a **literal type**: `string`, `number`, `boolean`, or `json`. A codec declares the literal types its columns are compatible with. PSL is only one way of writing a literal of a given type, and a codec never sees PSL syntax.

```prisma
model Account {
  id      Int      @id
  name    String   @default("anonymous")
  balance BigInt   @default(9007199254740993)
  price   Decimal  @default(1.50)
  active  Boolean  @default(true)
  meta    Jsonb    @default(json`{ "plan": "free", "seats": 1 }`)
  expires DateTime @default(sql`now() + interval '3 days'`)
}
```

Reading that model:

- `"anonymous"`, `9007199254740993`, `1.50`, and `true` are plain PSL scalars. They write a `string`, two `number` literals, and a `boolean` literal.
- `` json`...` `` is a tagged literal, the syntax [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md) defines: a tag followed by a string. The tag `json` names the literal type, and the string holds the JSON document. In backticks it needs no escaping and may span several lines.
- `` sql`now() + interval '3 days'` `` is also a tagged literal, but `sql` does not name a literal type. It writes a raw SQL expression, which becomes a function default the database evaluates. No codec is consulted.

Each column's codec decides whether the literal is acceptable and what it means. `pg/int8@1` is compatible with `number` literals and keeps every digit. `pg/jsonb@1` is compatible with `json` literals. Writing `` @default(json`{}`) `` on an `Int` column is an error that says `pg/int4@1` is compatible with `number` literals only.

This ADR replaces the PSL half of [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), which sketched `encodePsl` and `decodePsl` methods on codecs. The JSON half of ADR 184 is unchanged.

## Why literal types

### A codec cannot be asked "is this literal yours?" without a type to answer about

In SQL a codec can represent almost anything: a number, a document, a geometry, a vector, a timestamp. When a schema writes a default, something has to decide whether the written value suits the column. If the only information available is the characters the author typed, the codec has to try to read them and report failure by throwing. That makes compatibility a side effect of decoding, and the error the author sees is whatever the codec happened to throw.

A literal type turns the question into a lookup. The literal says what kind of value it is. The codec says which kinds it accepts. A mismatch is reported before anything is decoded, with a message that names the codec and the literal types it accepts.

### A codec should not depend on PSL

Codecs live below every authoring surface. PSL is one surface; the schema language of earlier Prisma versions, read by the contract source in [ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md), is another. If a codec received PSL text, or the PSL parser's idea of what a token is, every codec would be coupled to PSL's quoting, escaping, and tokenizer rules. A change to PSL syntax would become a change to every codec.

With literal types, each authoring surface maps its own syntax to literals, and codecs only ever receive a literal of a type they declared. PSL can gain new tags without any codec changing.

### One literal type means different things to different codecs

The contract stores a literal default in the column codec's JSON form ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md)). Those forms are chosen by each codec, so the same literal lands differently:

| Column | Codec | Written | Stored in `contract.json` |
|---|---|---|---|
| `Int` | `pg/int4@1` | `42` | `42` |
| `BigInt` | `pg/int8@1` | `9007199254740993` | `"9007199254740993"` |
| `Decimal` | `pg/numeric@1` | `1.50` | `"1.50"` |

All three are `number` literals. The literal type alone cannot choose between a JSON number and decimal text, and existing contracts must keep their JSON forms. So the conversion from a literal's value to the JSON form belongs to the codec, and the codec declares it together with the literal types it accepts.

## Literal types

A literal type defines what its value is, independently of how any authoring surface writes it.

| Literal type | Value | Written in PSL as |
|---|---|---|
| `string` | The text, with escapes resolved | A string scalar: `"anonymous"` |
| `number` | The number exactly as written, kept as text: `1.50`, `9007199254740993`, `-7`, `NaN`, `Infinity` | A number scalar: `1.50` |
| `boolean` | `true` or `false` | A boolean scalar: `true` |
| `json` | A JSON value | A tagged literal: `` json`{ "plan": "free" }` `` |

Two rules keep the values faithful:

1. **A `number` literal is never converted to a JavaScript number on the way to the codec.** Converting `9007199254740993` to a double rounds it, and converting `1.50` drops the trailing zero a `numeric` column keeps. The codec receives the text and decides.
2. **A `json` literal's body is parsed as JSON once, by the literal type.** Codecs receive the JSON value, not text they must parse themselves.

## Writing a literal in PSL

PSL has two ways to write a literal, and both produce the same literal.

**Plain scalars** write `string`, `number`, and `boolean` literals, and need no tag.

**Tagged literals** write any literal type, including ones with no plain scalar. A tagged literal is a tag followed by a string in any of PSL's three quote characters; its escapes and the canonical body (line endings normalised, the common indentation removed) are those of [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md). Tags are registered in `ControlMutationDefaults.defaultLiteralTagRegistry`, whose entry for a tag says which literal type it writes, and they follow ADR 129's prefixing rules. Each SQL target registers the `json` tag, with no prefixed alias. A tag that no pack in the contract's stack registers is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the registered tags.

The `sql` tag is the one tag that does not write a literal type. Its body is a SQL expression, not a value of the column's type, so it lowers to a function default (`{ kind: 'function', expression }`) on any column, and no codec compatibility applies.

The syntax tree keeps exactly what the author wrote. The formatter and the language server work from the tree; only the interpreter turns scalars and tagged literals into literals.

## Codecs declare compatible literal types

A codec descriptor declares the literal types its columns are compatible with. This is static metadata, next to `traits` and `targetTypes` on `CodecDescriptor`: it depends only on the codec id, never on a particular column's parameters.

For each compatible literal type, the declaration may carry two functions:

- **read**, from the literal's value to the codec's JSON form;
- **write**, from the codec's JSON form back to the literal's value, used when printing a schema.

When the literal's value already is the codec's JSON form, the declaration names the literal type and carries no functions. That is the common case:

| Codec | Compatible with | Functions |
|---|---|---|
| `pg/text@1` | `string` | none: the JSON form is the text |
| `pg/bytea@1` | `string` | none: the JSON form is base64 text |
| `pg/jsonb@1` | `json` | none: the JSON form is the JSON value |
| `pg/int8@1` | `number` | none: the JSON form is the digit text |
| `pg/numeric@1` | `number` | read removes leading zeros and the sign of zero, keeping trailing zeros |
| `pg/int4@1` | `number` | read turns whole-number text into a JSON number and refuses `1.5`, `NaN`, and `Infinity`; write does the reverse |

The declaration's exact field names are settled when it is built. Its shape is below, where `readWholeNumber` stands for a shared helper that refuses text that is not a whole number and names the codec in its message:

```ts
class PgJsonbDescriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = { json: {} } as const;
}

class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = {
    number: {
      read: (text: string): JsonValue => readWholeNumber(this.codecId, text),
      write: (json: JsonValue): string => String(json),
    },
  } as const;
}
```

The codec instance keeps the checks that depend on column parameters. After a read function produces the JSON form, the interpreter passes it through the codec's existing `decodeJson`. A `vector(3)` column given a four-element `json` literal is refused there, with the vector codec's own message.

## Reading a default

Each step has one owner.

1. **PSL parser.** Parses the `@default(...)` argument into a scalar or a tagged literal node, recording the source span.
2. **Interpreter.** Turns the node into a literal: a scalar becomes a `string`, `number`, or `boolean` literal; a tagged literal becomes a literal of the type its tag names. A `sql` tagged literal becomes a function default and stops here.
3. **Codec descriptor.** The interpreter looks up the column's codec descriptor. If the literal's type is not one it declares, the interpreter reports an error at the literal naming the codec and its compatible literal types.
4. **Read function.** The descriptor's read function, if any, turns the literal's value into the codec's JSON form.
5. **Codec instance.** `decodeJson` checks the value against the column. A value it refuses is reported at the literal with the codec's message.
6. **Contract.** The default is stored as `{ kind: 'literal', value }` in the codec's JSON form, like every literal default.

Other text-based contract sources follow the same steps from their own syntax. The reader for the earlier Prisma schema language ([ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)) turns that language's defaults into literals of a type and hands them to the same descriptors. The TypeScript contract builder is not a text source: `.default(value)` passes a value of the codec's own type, and TypeScript's types do the compatibility check.

## Printing a default

`contract infer` runs the steps in reverse for each introspected literal default:

1. The target reads the database's default into the codec's JSON form.
2. The printer takes the first literal type the column's codec declares and applies its write function, if any, to get the literal's value.
3. A `string`, `number`, or `boolean` literal prints as a plain scalar. Any other literal type prints as a tagged literal with the tag that writes it.
4. When the codec declares no literal type, or its write function cannot express the value, the printer writes the database's expression as a `sql` tagged literal. Infer never drops a default.

A printed schema therefore reads back to the same contract, because printing and reading pass through the same declaration.

## Responsibilities

| Layer | Owns |
|---|---|
| PSL parser | Scalars and tagged literal nodes, spans, canonicalisation of tagged bodies |
| Tag registry | Which literal type each tag writes; which tag writes raw SQL |
| Literal types | What each literal's value is: text, number text, boolean, JSON value |
| Interpreter and other text sources | Mapping their syntax to literals; reporting incompatibility at the literal |
| Codec descriptor | Compatible literal types; read and write functions where the JSON form differs |
| Codec instance | `decodeJson` checks that depend on column parameters |
| Contract | The JSON form, unchanged from [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md) |

## Consequences

### Benefits

- **Compatibility is checked before decoding.** An author who writes the wrong kind of value gets an error that names the codec and what it accepts, not whatever a failed decode happened to throw.
- **Codecs do not depend on PSL.** New tags, new fences, or a new text contract source change nothing in any codec.
- **Most codecs declare names only.** Conversion code exists only where a codec's JSON form differs from the literal's value, which in practice means number-like codecs.
- **Values are exact.** Numbers reach the codec as written, so big integers and decimals keep every digit.
- **JSON defaults are readable.** A document is written as JSON inside a fence, not as escaped text inside a string.
- **The contract format does not change.** A literal default is stored in the codec's JSON form, whichever way it was written.

### Costs

- **Codec authors learn one more concept.** A codec that should accept defaults written in a schema must declare its literal types.
- **Some values need a tag, and some existing schemas change.** A JSON default is written with the `json` tag, and a quoted JSON string or a quoted decimal is refused. Schemas that use either must be edited.
- **Every text contract source maps its own syntax.** The PSL interpreter and the earlier Prisma schema reader each turn their syntax into literals; neither holds per-type handling.

## Settled details

- **The first literal types** are `string`, `number`, `boolean`, and `json`. Byte strings, timestamps, and intervals are written as `string` literals holding the codec's text form.
- **Literal types are defined in the framework**, so a codec descriptor in any family can name them.
- **The declaration is optional.** A codec that declares no literal types accepts no literal defaults, and its columns take `sql` defaults only. Mongo codecs declare nothing, because no Mongo contract source reads defaults from text.
- **A JSON column is not compatible with a `string` literal.** `Jsonb @default("{}")` is an error that asks for `` json`{}` ``. The reader for the earlier Prisma schema language turns that language's quoted JSON into a `json` literal itself.
- **A decimal column is not compatible with a `string` literal.** `Decimal @default("1.50")` is an error, and the default is written `1.50`.
- **`NaN`, `Infinity`, and `-Infinity` are `number` literals**, because the PSL tokenizer reads them as numbers. Float and decimal codecs accept them; integer codecs refuse them.
- **JSON null is a value.** `` Json @default(json`null`) `` stores JSON null.
- **Enum columns are unchanged.** Their default is a bare member name, and enum codecs declare no literal types.
- **List columns keep PSL's list syntax.** Each element is a literal checked against the element codec's declaration, so `` Jsonb[] @default([json`{}`, json`[]`]) `` is valid and `Int[] @default([1, "x"])` is refused at its second element.
- **Diagnostics.** A literal whose type the codec does not declare is `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`. A value the codec refuses is `PSL_INVALID_DEFAULT_LITERAL`, with the codec's message. A `json` body that is not valid JSON is `PSL_INVALID_JSON_LITERAL`. Each diagnostic points at the literal.

## Alternatives considered

### Codec methods that receive the parser's classification

Codecs gain `encodePsl(value)` and `decodePsl(literal)`, where the literal is `{ kind: 'string' | 'number' | 'boolean', text }` produced by the PSL parser. This is close to the interface ADR 184 sketched.

Rejected. The input to every codec becomes the PSL tokenizer's view of the source, which couples codecs to PSL. A JSON document can only arrive as a string with its quotes escaped. And there is still no compatibility check: a codec discovers that a literal is not for it by failing to decode it.

### Codecs receive the raw argument text

Whatever is written between `@default(` and `)` goes to the column codec as text, and the codec parses it.

Rejected. The parser would need an unparsed argument form that exists for `@default` alone, and the formatter and language server would need to understand it. Every codec would reimplement PSL quoting and escaping. And a bare word such as `ACTIVE` could be an enum member or a string the codec reads, with nothing to tell them apart.

### The literal type alone decides the JSON form

Each literal type stores its value in one fixed JSON form, and codecs adapt their `decodeJson` to accept it.

Rejected. `pg/int4@1`, `pg/int8@1`, and `pg/numeric@1` would all have to share one JSON form for numbers, which changes the stored form of existing contracts and gives up either the precision of big integers or the JSON number that small integers are stored as.

### Try each JSON form until the codec accepts one

A `number` literal is offered to the codec as a JSON number first, then as text, and the first form `decodeJson` accepts wins.

Rejected. Compatibility is again discovered by failure, a value that two forms both decode is ambiguous, and the error the author sees comes from the last attempt rather than from the actual mismatch.

### A separate registry of PSL converters keyed by codec id

The PSL conversions live in a registry beside the codecs, as ADR 184's `PslLiteralCodec` interface suggested.

Rejected. The codec descriptor is already the codec-id-keyed home for a codec's static metadata. A second registry would hold the same kind of information in a second place and could drift from the codecs it describes.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md): codecs own the JSON form of values. Its JSON half stands; this ADR replaces its PSL half.
- [ADR 129 — Tagged literals carry raw SQL and other pack-owned text in PSL](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md): the tagged literal syntax, the canonical body, and tag registration. This ADR adds that a tag writes either a literal of a literal type or, for `sql`, a raw SQL expression.
- [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md): a second text contract source that maps its own syntax to literals.
- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md): historical context for typed literal defaults.
