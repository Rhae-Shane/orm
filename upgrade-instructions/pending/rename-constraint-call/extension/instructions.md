---
changes:
  - id: rename-check-constraint-call-is-rename-constraint-call
    summary: Replace `RenameCheckConstraintCall` with `RenameConstraintCall`, which takes the constraint kind as a new third constructor argument; pass `'checkConstraint'` for a check constraint.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])RenameCheckConstraintCall(?![\w$])'
---

## `rename-check-constraint-call-is-rename-constraint-call`

Find references to the class `RenameCheckConstraintCall`, imported from `@prisma/orm-postgres/target/op-factory-call` or `@internal/target-postgres/op-factory-call`. The class is now `RenameConstraintCall`. It also renames primary keys, unique constraints and foreign keys, so it takes the constraint kind as a new third constructor argument: `'primaryKey'`, `'unique'`, `'foreignKey'` or `'checkConstraint'`.

- Rename the import and every reference to `RenameConstraintCall`.
- Change `new RenameCheckConstraintCall(schema, table, from, to)` to `new RenameConstraintCall(schema, table, 'checkConstraint', from, to)`.
- Change a test of `call.factoryName === 'renameCheckConstraint'` to `call.factoryName === 'renameConstraint' && call.kind === 'checkConstraint'`.

The operation a check-constraint rename produces keeps its id, label and SQL. It now renders as `this.renameConstraint({ ..., kind: "checkConstraint", ... })`. Migration files that call `this.renameCheckConstraint({ ... })` keep working; leave them unchanged.
