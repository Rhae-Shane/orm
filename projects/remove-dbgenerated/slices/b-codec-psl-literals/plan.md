# Plan: Slice B — Codec-owned PSL literals

Spec: [`spec.md`](spec.md). Branch: `remove-dbgenerated-codec-psl-literals`, cut from `remove-dbgenerated-plan` rebased onto `main` so the project artifacts travel with the slice.

## At a glance

Eight sequential dispatches. The first adds the framework interface and the parser combinator. The next two make every codec in the repository implement the new members until the root typecheck is green. Then the three consumers move onto the codec, one dispatch each: the Prisma 8 interpreter, the Prisma 7 source, the infer printer. The last two dispatches add the journey tests and run every slice gate, then land the ADR amendment and docs.

## Decisions made while grounding the spec (recorded for the reviewer and for slice C)

These were raised to the operator before dispatch 1. Each is reversible; none changes an interface slice C relies on.

1. **Mongo codecs come from a factory, not classes.** `mongoCodec({...})` in `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts` returns object literals typed as `Codec`. The factory config gains required `encodePsl` and `decodePsl` members, so every Mongo codec declares its PSL form explicitly, matching the spec's "no implicit PSL form" reason for having no base-class default.
2. **Float `NaN`, `Infinity`, `-Infinity`.** The tokenizer already reads these as number tokens. `pg/float4@1` and `pg/float8@1` gain: `decodePsl` accepts the number literal and the three quoted strings and returns the JS number; `encodePsl` writes the quoted string; `encodeJson` writes the string for a non-finite number and `decodeJson` reads it back as a number. The contract JSON form (`"NaN"` as a string) is unchanged. `sqlite/real@1` and `sql/float@1` already refuse non-finite values in JSON and refuse them in PSL too. `pg/numeric@1` keeps printing `"NaN"` quoted, as infer does today.
3. **Infer-time literal the codec cannot read.** `mapDefault`'s literal arm calls the codec and lets a thrown error propagate. The Postgres printer catches it and falls back to the raw expression through the function mapping, which prints `dbgenerated(...)` until slice C replaces that fallback.
4. **`printer-config.ts` carries no formatter option.** The Postgres printer selects the formatter table by PSL type name inside `infer-model-blocks.ts`. That selection is replaced by resolving the column's codec from the Postgres codec descriptor registry using the column's native type and type params.
5. **Test doubles.** About forty object literals in test files implement `Codec`. Each gains the two members. Test files are exempt from the bare-cast rule.

## Dispatches

### Dispatch 1: Framework interface and parser combinator

- **Outcome:** `Codec` requires `encodePsl` and `decodePsl`, `CodecImpl` declares them abstract, `PslLiteral` and the shared helper module exist, and `literal()` parses a PSL string, number, or boolean into a `PslLiteral`.
- **Builds on:** Nothing. Spec sections B1, B2, B4.
- **Hands to:** The interface every codec dispatch implements and the combinator the interpreter dispatch uses.
- **Focus:** Tests first: `PslLiteral` type test; a `CodecImpl` subclass without the methods fails to compile (`test-d`); `literal()` accepts each literal kind, resolves string escapes, keeps number text verbatim, and rejects anything else with `Expected a string, number, or boolean literal`. Write `psl-literal-helpers.ts` with the shared pairs the spec names (identity-string, JSON-text, JS-number, boolean) plus tests. Update the `codec.ts` header comment to six methods. Add `'literal'` to `ArgTypeKind` and `LiteralArgType` to `attribute-spec/types.ts`; export `literal` and `PslLiteral` where `numLiteral` and `NumLiteral` are exported. Do not touch any codec class or any consumer. The root typecheck will be red after this dispatch; the two touched packages must be green.

### Dispatch 2: Postgres target and relational-core codecs

- **Outcome:** Every codec class in the Postgres target (`codecs.ts`, `temporal-codecs.ts`, `temporal-string-codecs.ts`, `date-codecs.ts`) and in `relational-core/src/ast/sql-codecs.ts` implements the two members by the B3 rule, and a table test per pack proves `decodePsl(encodePsl(v))` round-trips and a wrong-kind literal throws a message naming the codec.
- **Builds on:** Dispatch 1's interface and helpers.
- **Hands to:** Thirty-five codecs with PSL forms; the pattern the remaining packs copy.
- **Focus:** Tests first. Apply the one rule; named exceptions only for floats (decision 2 above), `pg/int8@1`, `pg/numeric@1`, `pg/unbounded-int@1` (digits read and printed as text, never through `Number()`), and `pg/int4@1`/`pg/int2@1`/`sql/int@1` (reject `1.5` with a message such as `pg/int4@1 reads a whole number literal; got 1.5`). `pg/numeric@1` canonicalises leading zeros and the sign of zero the way the deleted `number-literal-default.ts` does today, because the existing interpreter tests expect `007` → `7` and `-0` → `0`. If a codec's JSON form is a string but its PSL form must be a number, or the reverse, stop and report. Also update every test double in the two touched packages so their own typecheck is green.

### Dispatch 3: Remaining codecs, Mongo factory, and every test double

- **Outcome:** SQLite, pgvector, postgis, arktype-json, and the Mongo adapter codecs implement the two members; the `mongoCodec` factory requires them in its config; every object literal in the repository that implements `Codec` has them; the root `pnpm typecheck` is green.
- **Builds on:** Dispatch 2's pattern and helpers.
- **Hands to:** A repository where every codec has a PSL form, ready for the consumers.
- **Focus:** Tests first per pack (SQLite target, pgvector, postgis, arktype-json, Mongo codec package). Grep for `decodeJson` across `packages/**/test` and `test/**` to find every double; use the shared helpers so each double is two lines. Do not touch the interpreter, the printer, or the Prisma 7 source.

### Dispatch 4: Interpreter reads literals through the codec

- **Outcome:** `@default` literal arms are `literal()` and `list(literal())`; `psl-column-resolution.ts` decodes each literal with the column codec's `decodePsl` and reports `PSL_INVALID_DEFAULT_LITERAL` with the codec's message; `number-literal-default.ts`, its test, its `resolution` export, and the `numeric` trait check are deleted.
- **Builds on:** Dispatch 1's combinator; dispatch 3's green typecheck.
- **Hands to:** A Prisma 8 interpreter with no type-specific literal code; the `contract-prisma7` package is red on the deleted `numberLiteralDefault` import until dispatch 5.
- **Focus:** Tests first in `contract-psl/test/interpreter.defaults.test.ts`, every case the spec lists, each asserting the whole default object. `interpreter.number-defaults.test.ts` is rewritten to the codec rule (`Bytes @default(1234)` is now `PSL_INVALID_DEFAULT_LITERAL`). The fixture `codecLookup` must return codecs with `decodePsl`; use the real Postgres codec instances where the fixture already resolves Postgres codec ids. `DefaultArgValue` becomes `PslLiteral | PslLiteral[] | TypedFuncCall`. Do not edit the function arms or the enum arms. Slice A adds a tagged-literal arm after the function arms in the same function; keep the edit to the literal arms so the rebase is mechanical.

### Dispatch 5: Prisma 7 source reads literals through the codec

- **Outcome:** `Prisma7LiteralDefaultForm` has no `json` member; `defaults.ts` builds a `PslLiteral` from the expression, calls the codec's `decodePsl`, and turns a throw into `PSL.PRISMA7_UNKNOWN_DEFAULT` with the spec's message; `scalarValue`, `elementValue`, `numberValue`, `rejectedNumberReason`, `WHOLE_NUMBER_SCALARS`, `WHOLE_NUMBER_TEXT` are gone; the JSON-null diagnostic still fires on a `Json` field.
- **Builds on:** Dispatch 4's deleted export.
- **Hands to:** A green `contract-prisma7` package with the codec's messages in its fixtures.
- **Focus:** Tests first: `defaults` fixture with updated messages; `jsonLiteral Json @default("{\"a\":1}")` lowers through the codec; `integer-default-not-whole-number` expects the codec's message; `json-null-default` unchanged. The `sqlExpression` form stays for `bytea` and the temporal types. Grep gate: `kind: 'json'` returns nothing in `contract-prisma7` and `prisma7-binding.ts`.

### Dispatch 6: Printer prints literals through the codec

- **Outcome:** `mapDefault(columnDefault, { codec })` prints a literal as `formatPslLiteral(codec.encodePsl(codec.decodeJson(value)))`, per element for a list; `formatPslLiteral` and `escapePslString` live in the family; the formatter table in `psl-literals.ts` and `formatLiteralValue`/`quoteString`/`escapeString` in `default-mapping.ts` are deleted; `infer-model-blocks.ts` resolves the column's codec and falls back to the raw expression when the codec throws.
- **Builds on:** Dispatch 3's codecs.
- **Hands to:** A printer with no per-type formatter; `contract infer` prints every literal the codec can read in the form the interpreter reads.
- **Focus:** Tests first in `9-family/test/psl-contract-infer/default-mapping.test.ts` and `postgres/test/psl-infer/print-psl/print-psl.literal-defaults.test.ts` and `print-psl.defaults-and-types.test.ts`: every spec case printed back to its source text; `pg/float8@1` `NaN` prints `"NaN"`; `pg/int8@1` beyond 2^53 prints every digit; a jsonb object prints `"{\"a\":1}"`; `'null'::jsonb` now prints `@default("null")`; temporal literals still fall back to `dbgenerated(...)`. Grep gate: `PslDefaultValueFormat|formatLiteralValue` returns nothing under `packages`. `mapDefault`'s `codec` option is required for the literal arm; existing callers that only map function defaults are updated.

### Dispatch 7: Journeys and slice gates

- **Outcome:** The jsonb case in `infer-roundtrip-fidelity.e2e.test.ts` asserts emit succeeds without a workaround and infer prints `@default("{}")`; a new integration test emits the spec's Outcome schema, runs `db init`, verifies clean with `--schema-only --strict`, and reads a row whose defaults come back with decoded types; every slice gate is green.
- **Builds on:** Dispatches 4, 5, 6.
- **Hands to:** A branch whose tip passes `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check`, `pnpm lint:deps`, and the grep gates.
- **Focus:** Use the `:agent` command variants and read the log files. `pnpm fixtures:check` must show every existing `contract.json` byte-identical. Any red test outside the slice's surfaces is reported, not fixed.

### Dispatch 8: ADR amendment and docs

- **Outcome:** ADR 184 has the "Amendment — PSL literal methods live on `Codec`" section; the ADR index summary line is updated; `docs/reference/codec-authoring-guide.md` lists six methods with a JSON-valued and a string-valued example; `contract-psl/README.md` has the literal-defaults paragraph; `docs/reference/error-reference.md` has `PSL_INVALID_DEFAULT_LITERAL` and the updated Prisma 7 messages; `pnpm lint:docs` is green.
- **Builds on:** Dispatch 7's final shapes.
- **Hands to:** A PR-ready branch.
- **Focus:** Plain language, no hard-wrapped prose, ADR examples that match the code. Point the DDL note at `deferred.md` item 3.

## Dispatch-INVEST check

| Dispatch | Independent handoff | One coherent outcome | Binary verification |
|---|---|---|---|
| 1 | Interface and combinator usable before any codec adopts them. | One framework surface. | Two packages green; `test-d` proves omission fails to compile. |
| 2 | Postgres and relational-core codecs complete on their own. | One mechanical adoption with named exceptions. | Per-pack round-trip table tests. |
| 3 | The rest of the repository compiles. | One "every codec has a PSL form" outcome. | Root typecheck green. |
| 4 | Interpreter reads through the codec. | One consumer. | Spec's interpreter cases green. |
| 5 | Prisma 7 source reads through the codec. | One consumer. | Fixture tests green; grep gate empty. |
| 6 | Printer prints through the codec. | One consumer. | Printer cases green; grep gate empty. |
| 7 | End-to-end proof. | One gate outcome. | All commands green. |
| 8 | Docs match the code. | One documentation outcome. | `lint:docs` green. |

## Validation gates

### Per-dispatch baseline

- Tests before implementation. Each named test is red before the change that turns it green.
- After changing exported types, run that package's `pnpm build` before typechecking downstream packages.
- Run each touched package's `pnpm --filter <pkg> test` and `pnpm --filter <pkg> typecheck`.
- Stage files explicitly; commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` line. Do not push.
- No bare `as` in production code; no `any`; no comments that restate code.

### Dispatch-specific gates

- **D1:** `@internal/framework-components` and `@internal/psl-parser` test and typecheck.
- **D2:** `@internal/target-postgres` and `@internal/sql-relational-core` build, test, typecheck.
- **D3:** root `pnpm typecheck:agent` green; each touched pack's tests.
- **D4:** `@internal/sql-contract-psl` test and typecheck; grep `numberLiteralDefault` returns only the `contract-prisma7` import.
- **D5:** `@internal/sql-contract-prisma7` test and typecheck; grep `kind: 'json'` empty in the two named paths.
- **D6:** `@internal/family-sql` and `@internal/target-postgres` test and typecheck; grep `PslDefaultValueFormat|formatLiteralValue` empty under `packages`.
- **D7:** `pnpm typecheck:agent`, `pnpm test:packages:agent`, `pnpm test:integration:agent`, `pnpm test:e2e:agent`, `pnpm fixtures:check:agent`, `pnpm lint:deps:agent`.
- **D8:** `pnpm lint:docs`.

## Open items

- Slice A adds a tagged-literal arm after the function arms in `scalarDefaultArms` and its own `DefaultArgValue` member. Whichever slice merges second resolves that one function by hand to `[literal(), ...funcArms, taggedLiteral(tags)]` / `[list(literal()), ...funcArms, taggedLiteral(tags)]`.
- Slice C deletes the `dbgenerated(...)` fallback the printer keeps in dispatch 6 and the `// Raw default:` comment result.

## Retro (2026-09-16, slice B delivered as PR #30324)

Trigger: spec gaps recorded in the PR body. No halt condition fired; the shared-file edit stayed inside `scalarDefaultArms`.

- **The spec's per-codec inventory was written from class names, not from how codecs are built.** Mongo codecs come from a factory, and about forty test doubles implement `Codec` as object literals. Lesson: when a spec makes an interface member required, grep for every implementer (`decodeJson` across `src` and `test`), not only for `extends CodecImpl`, before sizing the slice.
- **A codec's JSON form and its PSL form can disagree with the spec's grouping.** Three codecs moved rule: postgis (hex string, not a JSON document), interval (ISO duration string), and numeric (also reads a quoted decimal because older schemas and the old printer used it). Lesson: derive the rule table from `encodeJson` return types in code, and let the implementer report each reassignment rather than pre-listing groups in the spec.
- **Changing what a value decodes to reaches the wire.** Making `"NaN"` decode to a real NaN broke the DDL renderer until the float codecs' `encode` learned to write the text. Lesson: a spec that changes `decodeJson` behaviour must name every consumer of the decoded value (DDL rendering, runtime encode), not only the PSL path.
- **Printer codec resolution keys on the printed PSL type name.** Several codecs share one native type, so the plan's "resolve by native type" could not pick the codec emit binds. Lesson: when a printer must pick a codec, key on whatever the reader will resolve from.
- **Docs rule versus spec instruction.** The spec asked the ADR to link into `projects/`; the always-apply doc-maintenance rule forbids it. Lesson: a slice spec's docs section should be checked against `.agents/rules/doc-maintenance.mdc` at planning time.
- **Process.** Reviewer and implementer ran in parallel on different dispatches, which cut wall time without a conflict; the slip of spawning a second implementer for dispatch 2 cost one re-read of the codebase and nothing else.
