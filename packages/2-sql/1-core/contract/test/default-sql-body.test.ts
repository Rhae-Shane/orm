import { describe, expect, it } from 'vitest';
import { clientGeneratorSqlDefaultBody, reservedSqlDefaultBody } from '../src/default-sql-body';

describe('reservedSqlDefaultBody', () => {
  it.each([
    ['now()', 'now'],
    [' now() ', 'now'],
    ['autoincrement()', 'autoincrement'],
    ['\n  autoincrement()\n', 'autoincrement'],
  ] as const)('names the Prisma default function %j spells', (body, name) => {
    expect(reservedSqlDefaultBody(body)).toBe(name);
  });

  it.each([
    ['NOW()'],
    ['now ()'],
    ['gen_random_uuid()'],
    ['uuid()'],
    ["now() + interval '1 day'"],
    ['CURRENT_TIMESTAMP'],
    [''],
  ])('passes %j as raw SQL', (body) => {
    expect(reservedSqlDefaultBody(body)).toBeUndefined();
  });
});

describe('clientGeneratorSqlDefaultBody', () => {
  it.each([
    ['nanoid()', 'nanoid'],
    ['nanoid(16)', 'nanoid'],
    ['NANOID(16)', 'nanoid'],
    [' uuid(7) ', 'uuid'],
    ['cuid(2)', 'cuid'],
    ['ulid()', 'ulid'],
    ['public.nanoid(16)', 'nanoid'],
    ['"nanoid"(16)', 'nanoid'],
    ['"uuid"()', 'uuid'],
    ['"public"."nanoid"(16)', 'nanoid'],
    ['public . nanoid(16)', 'nanoid'],
    ['public. nanoid(16)', 'nanoid'],
    ['"public" . "cuid"(2)', 'cuid'],
    ['"app""id".nanoid(16)', 'nanoid'],
    ['"app""id"."nanoid"(16)', 'nanoid'],
    ['"public" . nanoid(16)', 'nanoid'],
    ['public . "nanoid"(16)', 'nanoid'],
  ])('matches %j', (body, name) => {
    expect(clientGeneratorSqlDefaultBody(body)).toBe(name);
  });

  it.each([
    ['gen_random_uuid()'],
    ['app_nanoid(16)'],
    ['"app_nanoid"(16)'],
    ['"NANOID"(16)'],
    ['"NanoId"(16)'],
    ['"public"."NANOID"(16)'],
    ['NOW()'],
    ['random()'],
    [''],
  ])('ignores %j', (body) => {
    expect(clientGeneratorSqlDefaultBody(body)).toBeUndefined();
  });
});
