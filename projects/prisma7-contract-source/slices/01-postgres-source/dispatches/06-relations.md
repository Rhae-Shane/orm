# Dispatch 6: relations

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Make the Prisma 7 source interpret relations, such that every foreign key and every implicit junction table Prisma 7 created is described exactly (columns, targets, both referential actions) and `db verify` reports nothing for them, while the existing Prisma 8 PSL interpreter's relation behaviour is unchanged.

The property this preserves: relation pairing logic exists once, in `contract-psl`, and is reused; the Prisma 7 source adds only Prisma 7's defaults and junction synthesis on top.

## Scope

In:

1. **Decouple the pairing code.** In `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts`, `ModelBackrelationCandidate.field` is a `FieldSymbol` from the PSL parser (lines 54-62) but only `name`, `optional`, and `span` are read. Replace it with a structural type carrying exactly those, export what the Prisma 7 source needs from `contract-psl`'s `exports/`, and leave every existing `contract-psl` test unchanged and green. This is a surgical substrate change; commit it on its own before the Prisma 7 rules.
2. **Explicit relations.** `@relation(name?, fields, references, onDelete?, onUpdate?, map?)` on the FK side, the back-relation list or optional field on the other side. Omitted `onDelete` becomes `Restrict` when every FK scalar is required and `SetNull` when any is optional; omitted `onUpdate` becomes `Cascade`. Both are always written into the contract. `map` is ignored (foreign key names are not verified; note this in the fixture). One-to-one is recognised by `@unique` on the FK scalar(s) exactly as Prisma 7 does.
3. **Implicit many-to-many.** Two list fields with no `@relation(fields:)` on either side, paired by relation name or, unnamed, by being the only such pair between the two models. Synthesise a junction model named `AToB` (models in alphabetical order by model name, or the relation name when given) with table `_AToB` or `_<RelationName>`, columns `A` and `B` typed like the two models' id columns, primary key on `(A, B)` (Prisma 6.0.0 and later shape; `verification-results.md` item 4), index `_AToB_B_index` on `B`, foreign keys `A` to the alphabetically first model and `B` to the second, both `Cascade`/`Cascade`, and two back-relation list fields so the ORM sees an N:M relation through the junction (the shape `findJunctionFkPairs` recognises, `psl-relation-resolution.ts:229-288`). Self-referential: same, both columns to the same model; Prisma 7 requires a name there.
4. **Ignored parts.** A relation whose FK scalar is `@ignore`d, or whose target model is `@@ignore`d, is omitted entirely on both sides.
5. Fixtures for each of the above, and the negative cases: unresolvable back-relation (`PRISMA7_RELATION_UNRESOLVED`), ambiguous pair between two models without names, and a junction whose target id is composite (Prisma 7 forbids it; error with a span).

Out: Mongo; the printer; anything about defaults or indexes beyond the junction's own.

## Completed when

- [ ] `pnpm --filter @internal/sql-contract-psl test` green with no test file changed by the decoupling commit; `pnpm --filter @internal/sql-contract-psl build` then root `pnpm typecheck` green.
- [ ] Every fixture case in the Prisma 7 package passes and each produced contract passes `validateContract`.
- [ ] An integration test applies the relation and junction statements from `test/integration/test/fixtures/prisma7-source/supported/migration.sql` to `withDevDatabase` and verifies the interpreted `supported/schema.prisma`'s relations with zero relation-related findings (other findings may remain until dispatch 5 lands; assert on the relation paths only, and say which paths you filtered).

## Halt conditions

- The contract's N:M representation requires something the junction synthesis cannot satisfy (for example `through` needing a target-side full `@id` that the Prisma 7 model lacks). Report the spec line and the IR requirement.
- Decoupling `FieldSymbol` needs a change in `@internal/psl-parser`'s exported types. Report; do not change the parser here.

## References

- `psl-relation-resolution.ts` (`indexFkRelations` 107-168, `applyBackrelationCandidates` 378-494, `findJunctionFkPairs` 229-288), `interpreter.ts:1489-1494` (where actions are left undefined today), `packages/3-targets/3-targets/postgres/src/core/migrations/operations/constraints.ts:30-42`, `verification-results.md` item 4, `projects/sql-orm-many-to-many/` for the N:M contract shape.
- Failure modes F3, F11, F13, F14, F17 (state the property, not the mechanics), F24, F28; F5. Grep gates § Cross-cutting anti-patterns.

## Heartbeat and return shape

As dispatch 1.
