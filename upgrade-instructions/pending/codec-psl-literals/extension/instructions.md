---
changes:
  - id: codec-encode-psl-decode-psl
    summary: |
      `Codec` gains two required members, `encodePsl(value): PslLiteral` and `decodePsl(literal: PslLiteral): TInput`,
      abstract on `CodecImpl` and required in the `mongoCodec({...})` config. Every codec class and every
      `mongoCodec` call must implement them, using the shared pairs exported from
      `@internal/framework-components/codec`; a class without them no longer compiles.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'extends\s+CodecImpl\s*<'
        - 'mongoCodec\s*\(\s*\{'
---

## `codec-encode-psl-decode-psl`

A codec now owns the PSL literal that denotes its values in schema source (`@default(...)`). `PslLiteral` is `{ kind: 'string' | 'number' | 'boolean', text }` with the fence removed and escapes resolved; a number's digits arrive as written. Add the two members to every class that `extends CodecImpl<...>` and to every `mongoCodec({...})` config, choosing the pair by the codec's JSON form:

- JSON form is a string and the value is that string: `encodeStringPsl(value)` / `decodeStringPsl(this.id, literal)`.
- JSON form is a string but the value is not (bytes, a Temporal or Date value, a HEXEWKB geometry, an ISO duration): `encodeStringPsl(this.encodeJson(value))` / `this.decodeJson(decodeStringPsl(this.id, literal))`. Declare `encodeJson`'s return type as `string` so the first call typechecks.
- JSON form is a number and the value is a JavaScript number: `encodeNumberPsl(value)` / `decodeNumberPsl(this.id, literal)`; an integer codec reads `Number(decodeWholeNumberPsl(this.id, literal))` so a fraction is refused.
- JSON form is a boolean: `encodeBooleanPsl(value)` / `decodeBooleanPsl(this.id, literal)`.
- JSON form is an object, array, or null: `encodeJsonTextPsl(this.encodeJson(value))` / `this.decodeJson(decodeJsonTextPsl(this.id, literal))`.

```ts
import {
  decodeJsonTextPsl,
  encodeJsonTextPsl,
  type PslLiteral,
} from '@internal/framework-components/codec';

class PgVectorCodec extends CodecImpl<'pg/vector@1', readonly ['equality'], string, number[]> {
  // ... encode, decode, encodeJson, decodeJson unchanged

  encodePsl(value: number[]): PslLiteral {
    return encodeJsonTextPsl(this.encodeJson(value));
  }

  decodePsl(literal: PslLiteral): number[] {
    return this.decodeJson(decodeJsonTextPsl(this.id, literal));
  }
}
```

For a Mongo codec, pass the same pair as `encodePsl` and `decodePsl` members of the `mongoCodec({...})` config; there is no default. Each decode helper takes the codec id so its error names the codec, and the PSL interpreter reports that message as `PSL_INVALID_DEFAULT_LITERAL` at the `@default` attribute.
