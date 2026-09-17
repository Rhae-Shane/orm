import { describe, expect, it } from 'vitest';
import { postgresResolveDefault } from '../../src/core/default-normalizer';
import { renderDefaultLiteral } from '../../src/core/migrations/planner-ddl-builders';

describe('a literal-shaped sql`...` body on Postgres', () => {
  it("resolves to the literal introspection reads and renders back as '{}'::jsonb, exactly as authored", () => {
    const resolved = postgresResolveDefault(
      { kind: 'function', expression: "'{}'::jsonb" },
      'jsonb',
    );
    expect(resolved).toEqual({ kind: 'literal', value: {} });
    if (resolved.kind !== 'literal') throw new Error('literal expected');
    expect(renderDefaultLiteral(resolved.value, { nativeType: 'jsonb' })).toBe("'{}'::jsonb");
  });
});
