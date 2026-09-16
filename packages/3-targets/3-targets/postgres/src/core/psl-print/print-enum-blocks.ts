import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import type { PostgresNativeEnum } from '../postgres-native-enum';
import { buildNativeEnumBlock } from '../psl-infer/infer-enum-blocks';

export interface NativeEnumEmission {
  readonly blocks: readonly PslExtensionBlock[];
  /** Native type name, bare and schema-qualified, → the `native_enum` block that declares it. */
  readonly blockNamesByTypeName: ReadonlyMap<string, string>;
}

/**
 * Builds one `native_enum` block per enum type a namespace declares.
 *
 * The block's name is the name of the value set the enum derives, because that
 * is what a column referring to the enum points at: a column typed by the enum
 * names it directly, and an enum no column uses keeps the name its value set
 * carries. `@@map` carries the physical type name whenever the two differ.
 */
export function buildNativeEnumBlocksForNamespace(input: {
  readonly namespaceId: string;
  readonly nativeEnums: ReadonlyMap<string, PostgresNativeEnum>;
  readonly valueSetNames: ReadonlySet<string>;
  readonly columns: readonly StorageColumn[];
}): NativeEnumEmission {
  const valueSetNamesByTypeName = new Map<string, string>();
  for (const column of input.columns) {
    const valueSetName = column.valueSet?.entityName;
    if (valueSetName === undefined) continue;
    valueSetNamesByTypeName.set(column.nativeType, valueSetName);
  }

  const blocks: PslExtensionBlock[] = [];
  const blockNamesByTypeName = new Map<string, string>();
  for (const [entryName, nativeEnum] of input.nativeEnums) {
    const { typeName } = nativeEnum;
    const qualifiedTypeName = `${input.namespaceId}.${typeName}`;
    const blockName =
      valueSetNamesByTypeName.get(typeName) ??
      valueSetNamesByTypeName.get(qualifiedTypeName) ??
      (input.valueSetNames.has(entryName) ? entryName : typeName);
    blocks.push(buildNativeEnumBlock(blockName, typeName, nativeEnum.members));
    blockNamesByTypeName.set(typeName, blockName);
    blockNamesByTypeName.set(qualifiedTypeName, blockName);
  }
  return { blocks, blockNamesByTypeName };
}
