# Dispatch 3: parser grammar additions

**Slice plan:** `projects/prisma7-contract-source/slices/01-postgres-source/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Make `@internal/psl-parser` read two Prisma 7 constructs it currently mis-parses, such that a Prisma 7 interpreter can walk the tree with spans and existing Prisma 8 parsing is byte-for-byte unchanged.

1. **Attributes on enum members.** Inside a generic block (the shape `enum Role { … }` parses as today), a member line `USER @map("user")` currently yields `PSL_INVALID_EXTENSION_BLOCK_MEMBER`. It must parse as a member with a field-attribute list, exposing the attribute name and arguments with spans.
2. **Field lines inside `view` blocks.** `view ActiveUsers { id Int @unique }` currently parses `view` as a generic block and mangles the field line into key-value pairs. `view` must parse with the same body grammar as `model`, keeping its keyword so the interpreter can reject it by name. Do not add `view` to the interpreter's accepted keywords; the SQL and Mongo interpreters must still reject it (with the same `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` or a diagnostic pointing at the `view` keyword).

## Scope

In: `packages/1-framework/2-authoring/psl-parser/src/parse.ts`, the green-tree builder, the typed AST classes under `src/syntax/ast/`, and their tests. Read `.agents/skills/psl-ast-layers/SKILL.md` (or `skills-contrib/psl-ast-layers/SKILL.md`) before touching the tree layers.

Out: the interpreters, the printer, the language server, any package other than `psl-parser` unless its typecheck breaks from an exported type change (then fix the consumer minimally and say so).

## Completed when

- [ ] New tests in `packages/1-framework/2-authoring/psl-parser/test/` cover both constructs: member attributes with positional and named args, a `view` with several fields and a block attribute, and the negative case that a bare `enum` block without member attributes parses exactly as before.
- [ ] `projects/prisma7-contract-source/spike/schema.prisma` parses with zero diagnostics (write this as a test that reads the file, or copy the schema into the test fixture directory and cite the origin).
- [ ] `pnpm --filter @internal/psl-parser test`, `pnpm --filter @internal/psl-parser typecheck` (including `tsconfig.test.json` if present), `pnpm --filter @internal/psl-parser lint` are green, then `pnpm --filter @internal/psl-parser build` and `pnpm typecheck` at the repo root are green (F14, F24).

## Halt conditions

- The grammar change alters the tree for any existing Prisma 8 fixture (an existing parser or interpreter test changes its expectation). Stop and report which.
- Member attributes require a new node kind that the printer or language server switches over exhaustively and now fails to compile. Report; do not patch those packages beyond a minimal type fix.

## References

- Failure modes F3, F13, F14, F24, F28 in `drive/calibration/failure-modes.md`; F5 (no destructive git operations).
- Grep gates: no `any`, no file-extension imports (`drive/calibration/grep-library.md` § Cross-cutting anti-patterns).

## Heartbeat and return shape

As dispatch 1.
