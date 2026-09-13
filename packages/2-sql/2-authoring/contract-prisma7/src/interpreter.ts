import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  instantiateAuthoringEntityType,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import type {
  BlockSymbol,
  FieldSymbol,
  ModelSymbol,
  PslExtensionBlock,
  PslSpan,
  ResolvedAttribute,
  ResolvedTypeConstructorCall,
} from '@internal/psl-parser';
import {
  buildSymbolTable,
  keywordPslSpan,
  nodePslSpan,
  rangeToPslSpan,
  readResolvedAttribute,
  readResolvedAttributes,
} from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import { StringLiteralExprAst } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import {
  buildEntityTypesByDiscriminator,
  type ColumnDescriptor,
  resolveFieldTypeDescriptor,
} from '@internal/sql-contract-psl/resolution';
import {
  buildSqlContractFromDefinition,
  type FieldNode,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { prisma7Diagnostic } from './diagnostics';
import { prisma7PostgresNativeTypeMapping, prisma7ScalarMapping } from './native-types';
import {
  fieldListArgument,
  lowerRelations,
  parseRelationAttribute,
  type RelationField,
  type RelationModel,
} from './relations';

export interface Prisma7Document {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}

export interface InterpretPrisma7DocumentsInput {
  readonly documents: readonly Prisma7Document[];
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly nativeEnum: {
    readonly entityKind: string;
    readonly typeConstructor: readonly string[];
  };
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookup;
  readonly composedExtensions: readonly string[];
}

const SUMMARY = 'Prisma 7 schema interpretation failed';
const ACCEPTED_PROVIDERS: ReadonlySet<string> = new Set(['postgresql', 'postgres']);
const EMPTY_DESCRIPTORS: ReadonlyMap<string, ColumnDescriptor> = new Map();

interface SourceBlock {
  readonly block: BlockSymbol;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
}

interface EnumDeclaration {
  readonly name: string;
  readonly typeName: string;
  readonly namespaceId: string;
  readonly members: readonly {
    readonly name: string;
    readonly value: string;
    readonly span: PslSpan;
  }[];
  readonly span: PslSpan;
  readonly sourceId: string;
}

interface ModelDeclaration {
  readonly symbol: ModelSymbol;
  readonly sourceId: string;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly idFields: readonly string[];
  readonly uniqueFieldSets: readonly (readonly string[])[];
}

interface ModelBuild {
  readonly declaration: ModelDeclaration;
  readonly columns: Map<string, FieldNode>;
  readonly ignoredFields: Set<string>;
  idFields: readonly string[];
  readonly uniqueFieldSets: (readonly string[])[];
  readonly relationFields: RelationField[];
}

type NamespaceEntities = Map<string, Record<string, Record<string, unknown>>>;

function stringArgument(attribute: ResolvedAttribute): string | undefined {
  const argument =
    attribute.args.find((arg) => arg.kind === 'positional') ??
    attribute.args.find((arg) => arg.name === 'name');
  const expression = argument?.expression;
  if (expression === undefined) return undefined;
  return StringLiteralExprAst.cast(expression.syntax)?.value();
}

function scalarValue(block: PslExtensionBlock, key: string): string | undefined {
  const parameter = block.parameters[key];
  if (parameter?.kind !== 'value') return undefined;
  try {
    const parsed: unknown = JSON.parse(parameter.raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parameterSpan(block: PslExtensionBlock, key: string): PslSpan {
  const parameter = block.parameters[key];
  return parameter === undefined ? block.span : parameter.span;
}

export function interpretPrisma7Documents(
  input: InterpretPrisma7DocumentsInput,
): Result<Contract, ContractSourceDiagnostics> {
  const diagnostics: ContractSourceDiagnostic[] = [...input.seedDiagnostics];
  const defaultNamespaceId = input.target.defaultNamespaceId;
  const datasources: SourceBlock[] = [];
  const enumBlocks: SourceBlock[] = [];
  const models: ModelDeclaration[] = [];
  const ignoredModels = new Set<string>();

  for (const { document, sourceFile, sourceId } of input.documents) {
    const { table, diagnostics: tableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: {},
    });
    for (const diagnostic of tableDiagnostics) {
      diagnostics.push({
        code: diagnostic.code,
        message: diagnostic.message,
        sourceId,
        span: rangeToPslSpan(diagnostic.range, sourceFile),
      });
    }
    const unsupported = (keyword: string, span: PslSpan): void => {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: `Unsupported top-level block "${keyword}"`,
        sourceId,
        span,
      });
    };
    for (const block of Object.values(table.topLevel.blocks)) {
      switch (block.keyword) {
        case 'datasource':
          datasources.push({ block, sourceId, sourceFile });
          break;
        case 'generator':
          break;
        case 'enum':
          enumBlocks.push({ block, sourceId, sourceFile });
          break;
        case 'view':
          diagnostics.push(
            prisma7Diagnostic(
              'PRISMA7_VIEW_UNSUPPORTED',
              `View "${block.name}" is not supported; Prisma 8 has no views. Remove the view or replace it with a model over the underlying table.`,
              sourceId,
              keywordPslSpan(block.node.syntax, block.keyword, sourceFile),
            ),
          );
          break;
        default:
          unsupported(block.keyword, keywordPslSpan(block.node.syntax, block.keyword, sourceFile));
      }
    }
    for (const namespace of Object.values(table.topLevel.namespaces)) {
      unsupported('namespace', namespace.span);
    }
    for (const compositeType of Object.values(table.topLevel.compositeTypes)) {
      unsupported('type', compositeType.span);
    }
    for (const namedType of Object.values(table.topLevel.namedTypes)) {
      unsupported('types', namedType.span);
    }
    for (const symbol of Object.values(table.topLevel.models)) {
      const declaration = readModelDeclaration(symbol, sourceId, defaultNamespaceId, diagnostics);
      if (declaration === undefined) {
        ignoredModels.add(symbol.name);
      } else {
        models.push(declaration);
      }
    }
  }

  checkDatasource(datasources, input.documents[0]?.sourceId ?? 'schema.prisma', diagnostics);

  const enums = new Map<string, EnumDeclaration>();
  for (const source of enumBlocks) {
    const declaration = readEnumDeclaration(source, defaultNamespaceId, diagnostics);
    if (declaration !== undefined) enums.set(declaration.name, declaration);
  }
  const namespaceEntities = lowerNativeEnums(enums, input, diagnostics);

  const modelNames = new Set([...models.map((model) => model.symbol.name), ...ignoredModels]);
  const scalarColumnDescriptors = collectScalarTypeConstructors(input.authoringContributions.type);
  const composedExtensions = new Set(input.composedExtensions);
  const builds = new Map<string, ModelBuild>();
  for (const declaration of models) {
    const build: ModelBuild = {
      declaration,
      columns: new Map(),
      ignoredFields: new Set(),
      idFields: declaration.idFields,
      uniqueFieldSets: [...declaration.uniqueFieldSets],
      relationFields: [],
    };
    for (const field of Object.values(declaration.symbol.fields)) {
      readField({
        field,
        build,
        modelNames,
        ignoredModels,
        enums,
        namespaceEntities,
        scalarColumnDescriptors,
        composedExtensions,
        input,
        diagnostics,
      });
    }
    builds.set(declaration.symbol.name, build);
  }

  const relationModels = new Map<string, RelationModel>();
  for (const [modelName, build] of builds) {
    relationModels.set(modelName, {
      modelName,
      tableName: build.declaration.tableName,
      namespaceId: build.declaration.namespaceId,
      sourceId: build.declaration.sourceId,
      columns: build.columns,
      ignoredFields: build.ignoredFields,
      idFields: build.idFields,
      uniqueFieldSets: build.uniqueFieldSets,
      relationFields: build.relationFields,
    });
  }
  const lowered = lowerRelations(relationModels, diagnostics);

  const modelNodes: ModelNode[] = [];
  for (const [modelName, build] of builds) {
    const model = relationModels.get(modelName);
    if (model === undefined) continue;
    const id = keyColumns(model, model.idFields);
    const uniques = model.uniqueFieldSets
      .map((fieldNames) => keyColumns(model, fieldNames))
      .filter((columns): columns is readonly string[] => columns !== undefined)
      .map((columns) => ({ columns }));
    const foreignKeys = lowered.foreignKeys.get(modelName);
    const relations = lowered.relations.get(modelName);
    modelNodes.push({
      modelName,
      tableName: model.tableName,
      namespaceId: model.namespaceId,
      fields: [...build.columns.values()],
      ...(id !== undefined && id.length > 0 ? { id: { columns: id } } : {}),
      ...(uniques.length > 0 ? { uniques } : {}),
      ...(foreignKeys !== undefined ? { foreignKeys } : {}),
      ...(relations !== undefined ? { relations } : {}),
    });
  }
  for (const junction of lowered.junctions) {
    const relations = lowered.relations.get(junction.modelName);
    modelNodes.push(relations === undefined ? junction : { ...junction, relations });
  }

  if (diagnostics.length > 0) {
    return notOk({ summary: SUMMARY, diagnostics });
  }

  const createNamespace = (namespace: SqlNamespaceInput): SqlNamespaceBase => {
    const entities = namespaceEntities.get(namespace.id);
    if (entities === undefined) return input.createNamespace(namespace);
    const valueSet = { ...namespace.entries['valueSet'], ...entities['valueSet'] };
    return input.createNamespace({
      ...namespace,
      entries: {
        ...namespace.entries,
        ...entities,
        ...(Object.keys(valueSet).length > 0 ? { valueSet } : {}),
      },
    });
  };

  return ok(
    buildSqlContractFromDefinition(
      {
        target: input.target,
        warnings: undefined,
        createNamespace,
        ...(namespaceEntities.size > 0 ? { namespaces: [...namespaceEntities.keys()] } : {}),
        models: modelNodes,
      },
      input.codecLookup,
    ),
  );
}

function checkDatasource(
  datasources: readonly SourceBlock[],
  fallbackSourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): void {
  const [datasource] = datasources;
  if (datasource === undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_PROVIDER_MISMATCH',
        'No datasource block found; a Prisma 7 schema for Postgres declares `datasource db { provider = "postgresql" }`.',
        fallbackSourceId,
        undefined,
      ),
    );
    return;
  }
  const block = datasource.block.block;
  const provider = scalarValue(block, 'provider');
  if (provider === undefined || !ACCEPTED_PROVIDERS.has(provider)) {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_PROVIDER_MISMATCH',
        provider === undefined
          ? 'The datasource block declares no string `provider`; this contract source reads Prisma 7 schemas for provider "postgresql".'
          : `The datasource provider is "${provider}"; this contract source reads Prisma 7 schemas for provider "postgresql".`,
        datasource.sourceId,
        parameterSpan(block, 'provider'),
      ),
    );
  }
  if (scalarValue(block, 'relationMode') === 'prisma') {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_RELATION_MODE_UNSUPPORTED',
        'relationMode = "prisma" is not supported; Prisma 8 verifies foreign keys in the database. Remove relationMode or set it to "foreignKeys".',
        datasource.sourceId,
        parameterSpan(block, 'relationMode'),
      ),
    );
  }
}

function keyColumns(
  model: RelationModel,
  fieldNames: readonly string[],
): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of fieldNames) {
    const column = model.columns.get(fieldName);
    if (column === undefined) return undefined;
    columns.push(column.columnName);
  }
  return columns;
}

function requireFieldList(
  attribute: ResolvedAttribute,
  owner: string,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): readonly string[] | undefined {
  const fields = fieldListArgument(attribute);
  if (fields === undefined || fields.length === 0) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `"${owner}": attribute "@@${attribute.name}" expects a non-empty list of field names.`,
      sourceId,
      span: attribute.span,
    });
    return undefined;
  }
  return fields;
}

function readModelDeclaration(
  symbol: ModelSymbol,
  sourceId: string,
  defaultNamespaceId: string,
  diagnostics: ContractSourceDiagnostic[],
): ModelDeclaration | undefined {
  if (symbol.attributes.some((attribute) => attribute.name === 'ignore')) return undefined;
  let tableName = symbol.name;
  let namespaceId = defaultNamespaceId;
  let idFields: readonly string[] = [];
  const uniqueFieldSets: (readonly string[])[] = [];
  for (const attribute of symbol.attributes) {
    switch (attribute.name) {
      case 'map':
        tableName =
          requireStringArgument(attribute, symbol.name, sourceId, diagnostics) ?? tableName;
        break;
      case 'schema':
        namespaceId =
          requireStringArgument(attribute, symbol.name, sourceId, diagnostics) ?? namespaceId;
        break;
      case 'id':
        idFields = requireFieldList(attribute, symbol.name, sourceId, diagnostics) ?? idFields;
        break;
      case 'unique': {
        const fields = requireFieldList(attribute, symbol.name, sourceId, diagnostics);
        if (fields !== undefined) uniqueFieldSets.push(fields);
        break;
      }
      default:
        diagnostics.push(
          prisma7Diagnostic(
            'PRISMA7_UNKNOWN_ATTRIBUTE',
            `Model "${symbol.name}": attribute "@@${attribute.name}" is not supported yet by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
    }
  }
  return { symbol, sourceId, namespaceId, tableName, idFields, uniqueFieldSets };
}

function requireStringArgument(
  attribute: ResolvedAttribute,
  owner: string,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): string | undefined {
  const value = stringArgument(attribute);
  if (value === undefined) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `"${owner}": attribute "${attribute.name}" expects one string argument.`,
      sourceId,
      span: attribute.span,
    });
  }
  return value;
}

function readEnumDeclaration(
  source: SourceBlock,
  defaultNamespaceId: string,
  diagnostics: ContractSourceDiagnostic[],
): EnumDeclaration | undefined {
  const { block, sourceId, sourceFile } = source;
  let typeName = block.name;
  let namespaceId = defaultNamespaceId;
  for (const attribute of readResolvedAttributes(block.node.attributes(), sourceFile)) {
    switch (attribute.name) {
      case 'map':
        typeName = requireStringArgument(attribute, block.name, sourceId, diagnostics) ?? typeName;
        break;
      case 'schema':
        namespaceId =
          requireStringArgument(attribute, block.name, sourceId, diagnostics) ?? namespaceId;
        break;
      default:
        diagnostics.push(
          prisma7Diagnostic(
            'PRISMA7_UNKNOWN_ATTRIBUTE',
            `Enum "${block.name}": attribute "@@${attribute.name}" is not supported by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
    }
  }
  const members: EnumDeclaration['members'][number][] = [];
  for (const entry of block.node.entries()) {
    const name = entry.key()?.name();
    if (name === undefined) continue;
    let value = name;
    const span = nodePslSpan(entry.syntax, sourceFile);
    for (const attributeNode of entry.attributes()) {
      const attribute = readResolvedAttribute(attributeNode, sourceFile);
      if (attribute.name === 'map') {
        value =
          requireStringArgument(attribute, `${block.name}.${name}`, sourceId, diagnostics) ?? value;
      } else {
        diagnostics.push(
          prisma7Diagnostic(
            'PRISMA7_UNKNOWN_ATTRIBUTE',
            `Enum member "${block.name}.${name}": attribute "@${attribute.name}" is not supported by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
      }
    }
    members.push({ name, value, span });
  }
  return { name: block.name, typeName, namespaceId, members, span: block.span, sourceId };
}

function lowerNativeEnums(
  enums: ReadonlyMap<string, EnumDeclaration>,
  input: InterpretPrisma7DocumentsInput,
  diagnostics: ContractSourceDiagnostic[],
): NamespaceEntities {
  const result: NamespaceEntities = new Map();
  if (enums.size === 0) return result;
  const { entityKind } = input.nativeEnum;
  const descriptor: AuthoringEntityTypeDescriptor | undefined = buildEntityTypesByDiscriminator(
    input.authoringContributions,
  ).get(entityKind);
  for (const declaration of enums.values()) {
    if (descriptor === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PRISMA7_UNSUPPORTED_TYPE',
          `Enum "${declaration.name}" cannot be lowered: target "${input.target.targetId}" registers no "${entityKind}" entity kind.`,
          declaration.sourceId,
          declaration.span,
        ),
      );
      continue;
    }
    const context: AuthoringEntityContext = {
      family: input.target.familyId,
      target: input.target.targetId,
      codecLookup: input.codecLookup,
      sourceId: declaration.sourceId,
      diagnostics: {
        push: (diagnostic) => {
          diagnostics.push(
            blindCast<ContractSourceDiagnostic, 'entity factory diagnostics are span-compatible'>(
              diagnostic,
            ),
          );
        },
      },
    };
    const block: PslExtensionBlock & { readonly namespaceId: string } = {
      kind: entityKind,
      keyword: entityKind,
      name: declaration.name,
      parameters: Object.fromEntries(
        declaration.members.map((member) => [
          member.name,
          { kind: 'value', raw: JSON.stringify(member.value), span: member.span },
        ]),
      ),
      blockAttributes: [],
      attributes: { map: { args: { name: declaration.typeName }, span: declaration.span } },
      span: declaration.span,
      namespaceId: declaration.namespaceId,
    };
    const entity: unknown = instantiateAuthoringEntityType(
      entityKind,
      descriptor,
      [block],
      context,
    );
    if (entity === undefined) continue;
    const entities = result.get(declaration.namespaceId) ?? {};
    result.set(declaration.namespaceId, entities);
    entities[entityKind] = { ...entities[entityKind], [declaration.name]: entity };
    const valueSet = deriveValueSetFromEntity(descriptor.output, entity);
    if (valueSet !== undefined) {
      entities['valueSet'] = { ...entities['valueSet'], [declaration.name]: valueSet };
    }
  }
  return result;
}

function readField(args: {
  readonly field: FieldSymbol;
  readonly build: ModelBuild;
  readonly modelNames: ReadonlySet<string>;
  readonly ignoredModels: ReadonlySet<string>;
  readonly enums: ReadonlyMap<string, EnumDeclaration>;
  readonly namespaceEntities: NamespaceEntities;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly input: InterpretPrisma7DocumentsInput;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  const { field, build, diagnostics, input } = args;
  const model = build.declaration;
  const sourceId = model.sourceId;
  const label = `Field "${model.symbol.name}.${field.name}"`;
  if (field.attributes.some((attribute) => attribute.name === 'ignore')) {
    build.ignoredFields.add(field.name);
    return;
  }
  const isRelationField =
    args.modelNames.has(field.typeName) && field.typeConstructor === undefined;

  let columnName = field.name;
  let nativeType: { readonly name: string; readonly attribute: ResolvedAttribute } | undefined;
  let relation: ResolvedAttribute | undefined;
  for (const attribute of field.attributes) {
    if (attribute.name === 'map' && !isRelationField) {
      columnName = requireStringArgument(attribute, label, sourceId, diagnostics) ?? columnName;
    } else if (attribute.name.startsWith('db.') && !isRelationField) {
      nativeType = { name: attribute.name.slice('db.'.length), attribute };
    } else if (attribute.name === 'id' && !isRelationField) {
      build.idFields = [field.name];
    } else if (attribute.name === 'unique' && !isRelationField) {
      build.uniqueFieldSets.push([field.name]);
    } else if (attribute.name === 'relation' && isRelationField) {
      relation = attribute;
    } else {
      diagnostics.push(
        prisma7Diagnostic(
          'PRISMA7_UNKNOWN_ATTRIBUTE',
          `${label}: attribute "@${attribute.name}" is not supported yet by the Prisma 7 contract source.`,
          sourceId,
          attribute.span,
        ),
      );
    }
  }

  if (field.malformedType) return;
  if (field.typeConstructor !== undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_UNSUPPORTED_TYPE',
        `${label} has type "${field.typeConstructor.path.join('.')}(...)", which has no Prisma 8 codec. Remove the field or map it to a supported type.`,
        sourceId,
        field.typeConstructor.span,
      ),
    );
    return;
  }
  if (args.ignoredModels.has(field.typeName)) return;
  if (isRelationField) {
    const attribute =
      relation === undefined
        ? undefined
        : parseRelationAttribute(relation, label, sourceId, diagnostics);
    if (relation !== undefined && attribute === undefined) return;
    build.relationFields.push({ field, targetModelName: field.typeName, attribute });
    return;
  }

  const enumDeclaration = args.enums.get(field.typeName);
  let call: ResolvedTypeConstructorCall;
  if (enumDeclaration !== undefined) {
    if (enumDeclaration.namespaceId !== model.namespaceId) {
      diagnostics.push(
        prisma7Diagnostic(
          'PRISMA7_ENUM_NAMESPACE_MISMATCH',
          `${label} uses enum "${enumDeclaration.name}" from schema "${enumDeclaration.namespaceId}", but the model is in schema "${model.namespaceId}". Prisma 8 columns reference the enum type of their own schema; declare the enum in "${model.namespaceId}" or move the model.`,
          sourceId,
          field.span,
        ),
      );
      return;
    }
    call = {
      path: input.nativeEnum.typeConstructor,
      args: [{ kind: 'positional', value: enumDeclaration.name, span: field.span }],
      span: field.span,
    };
  } else {
    const scalar = prisma7ScalarMapping(field.typeName);
    if (scalar === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PRISMA7_UNSUPPORTED_TYPE',
          `${label} has unknown type "${field.typeName}".`,
          sourceId,
          field.span,
        ),
      );
      return;
    }
    let mapping = scalar;
    let span = field.span;
    if (nativeType !== undefined) {
      const native = prisma7PostgresNativeTypeMapping(
        nativeType.name,
        nativeType.attribute.args.map((arg) => arg.value),
      );
      if (native === undefined) {
        diagnostics.push(
          prisma7Diagnostic(
            'PRISMA7_NATIVE_TYPE_UNSUPPORTED',
            `${label}: native type "@db.${nativeType.name}" has no Prisma 8 codec. Change the column type or keep the column out of the contract with @ignore.`,
            sourceId,
            nativeType.attribute.span,
          ),
        );
        return;
      }
      mapping = native;
      span = nativeType.attribute.span;
    }
    call = {
      path: [mapping.constructorName],
      args: mapping.args.map((value) => ({ kind: 'positional', value, span })),
      span,
    };
  }

  const namespaceExtensionEntities = args.namespaceEntities.get(model.namespaceId);
  const resolved = resolveFieldTypeDescriptor({
    field: { ...field, typeConstructor: call },
    enumTypeDescriptors: EMPTY_DESCRIPTORS,
    namedTypeDescriptors: EMPTY_DESCRIPTORS,
    scalarColumnDescriptors: args.scalarColumnDescriptors,
    authoringContributions: input.authoringContributions,
    composedExtensions: args.composedExtensions,
    familyId: input.target.familyId,
    targetId: input.target.targetId,
    diagnostics,
    sourceId,
    entityLabel: label,
    namespaceId: model.namespaceId,
    ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
    codecLookup: input.codecLookup,
  });
  if (!resolved.ok) {
    if (!resolved.alreadyReported) {
      diagnostics.push(
        prisma7Diagnostic(
          'PRISMA7_UNSUPPORTED_TYPE',
          `${label} type "${field.typeName}" could not be resolved against target "${input.target.targetId}".`,
          sourceId,
          field.span,
        ),
      );
    }
    return;
  }
  build.columns.set(field.name, {
    fieldName: field.name,
    columnName,
    descriptor: resolved.descriptor,
    nullable: field.optional || field.list,
    ...(field.list ? { many: true } : {}),
  });
}
