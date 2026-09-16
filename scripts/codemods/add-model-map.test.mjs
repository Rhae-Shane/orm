import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addModelMaps } from './add-model-map.mjs';

describe('addModelMaps', () => {
  it('appends @@map with the first letter lowered as the last line of a model block', () => {
    const input = ['model UserProfile {', '  id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile {',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('inserts after existing block attributes such as @@index', () => {
    const input = [
      'model OrderItem {',
      '  id      Int @id',
      '  orderId Int',
      '',
      '  @@index([orderId])',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model OrderItem {',
      '  id      Int @id',
      '  orderId Int',
      '',
      '  @@index([orderId])',
      '  @@map("orderItem")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('leaves a model that already has @@map untouched', () => {
    const input = ['model TeamMember {', '  id Int @id', '  @@map("team_member")', '}', ''].join(
      '\n',
    );
    strictEqual(addModelMaps(input), input);
  });

  it('matches the indentation of the block fields', () => {
    const input = ['model UserProfile {', '    id Int @id', '}', ''].join('\n');
    const expected = [
      'model UserProfile {',
      '    id Int @id',
      '    @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('ignores enum, view, native_enum and other block kinds', () => {
    const input = [
      'datasource db {',
      '  provider = "postgresql"',
      '}',
      '',
      'enum OrderStatus {',
      '  PENDING',
      '  SHIPPED',
      '}',
      '',
      'native_enum PaymentKind {',
      '  CARD',
      '}',
      '',
      'view ActiveUser {',
      '  id Int',
      '}',
      '',
      'type ShippingAddress {',
      '  street String',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), input);
  });

  it('leaves a variant with @@base and no @@map alone because it shares the base storage', () => {
    const input = [
      'model Task {',
      '  id   Int    @id',
      '  kind String',
      '',
      '  @@discriminator(kind)',
      '}',
      '',
      'model BugReport {',
      '  id       Int    @id',
      '  severity String',
      '',
      '  @@base(Task, "bug")',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model Task {',
      '  id   Int    @id',
      '  kind String',
      '',
      '  @@discriminator(kind)',
      '  @@map("task")',
      '}',
      '',
      'model BugReport {',
      '  id       Int    @id',
      '  severity String',
      '',
      '  @@base(Task, "bug")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles a Mongo-style model', () => {
    const input = [
      'model UserProfile {',
      '  id       ObjectId @id @map("_id")',
      '  nickname String',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model UserProfile {',
      '  id       ObjectId @id @map("_id")',
      '  nickname String',
      '  @@map("userProfile")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles several models in one file, mapping only the unmapped ones', () => {
    const input = [
      'model UserProfile {',
      '  id Int @id',
      '}',
      '',
      'model TeamMember {',
      '  id Int @id',
      '',
      '  @@map("team_member")',
      '}',
      '',
      'model OrderItem {',
      '  id Int @id',
      '}',
      '',
    ].join('\n');
    const expected = [
      'model UserProfile {',
      '  id Int @id',
      '  @@map("userProfile")',
      '}',
      '',
      'model TeamMember {',
      '  id Int @id',
      '',
      '  @@map("team_member")',
      '}',
      '',
      'model OrderItem {',
      '  id Int @id',
      '  @@map("orderItem")',
      '}',
      '',
    ].join('\n');
    strictEqual(addModelMaps(input), expected);
  });

  it('handles a model written on a single line', () => {
    const input = 'model UserProfile { id Int @id email String? @unique }\n';
    const expected =
      'model UserProfile { id Int @id email String? @unique @@map("userProfile") }\n';
    strictEqual(addModelMaps(input), expected);
    strictEqual(addModelMaps(expected), expected);
  });

  it('is idempotent', () => {
    const input = ['model UserProfile {', '  id Int @id', '}', ''].join('\n');
    const once = addModelMaps(input);
    strictEqual(addModelMaps(once), once);
  });
});
