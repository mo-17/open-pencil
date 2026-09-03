/* eslint-disable max-lines -- staged SQL keeps every provider binding and operation renderer in one auditable module */
import type {
  BackendApplicationSpecV1,
  DataEntityIR,
  DataFieldIR,
  DataForeignKeyIR,
  DataIndexIR,
  DataUniqueIR,
  StagedMigrationExecutionPlanV1,
  StagedMigrationOperationV1,
  StagedMigrationTypedLiteralV1
} from '@open-pencil/lowcode/backend'

import {
  formatSupabaseManagedMarker,
  type SupabaseInspectedMigrationSnapshotV1
} from '../inspection'
import { addBlocker, qualified, quoteIdentifier, quoteLiteral, stableSQLName } from './common'
import type { SupabaseMigrationReviewBlockerV1 } from './contract'
import { fieldDefinition, markerLiteral, namesForFields } from './sql'

interface StagedMigrationSQLResult {
  readonly statements: readonly string[]
  readonly operationIds: readonly string[]
  readonly existingTableNames: readonly string[]
}

interface RenderContext {
  readonly application: BackendApplicationSpecV1
  readonly snapshot: SupabaseInspectedMigrationSnapshotV1
  readonly plan: StagedMigrationExecutionPlanV1
  readonly blockers: SupabaseMigrationReviewBlockerV1[]
  readonly existingTableNames: Set<string>
  readonly renamedTables: ReadonlyMap<string, string>
  readonly renamedFields: ReadonlyMap<string, string>
  readonly renderedIndexIds: Set<string>
}

function operationPath(operation: StagedMigrationOperationV1): string {
  return `$.stagedExecution.executionPlan.operations.${operation.id}`
}

function targetEntity(
  context: RenderContext,
  entityId: string,
  path: string
): DataEntityIR | undefined {
  const entity = context.application.dataModel.entities.find(
    (entry) => entry.id === entityId && entry.management === 'managed'
  )
  if (!entity) {
    addBlocker(
      context.blockers,
      'supabase-staged-target-entity-binding-required',
      path,
      'Staged SQL requires an exact managed target entity binding.'
    )
  }
  return entity
}

function liveTable(
  context: RenderContext,
  entityId: string,
  path: string
): Extract<SupabaseInspectedMigrationSnapshotV1['objects'][number], { kind: 'table' }> | undefined {
  const table = context.snapshot.objects.find(
    (entry) =>
      entry.kind === 'table' && entry.management === 'managed' && entry.openPencilId === entityId
  )
  if (table?.kind !== 'table') {
    addBlocker(
      context.blockers,
      'supabase-staged-live-table-binding-required',
      path,
      'Staged SQL requires an exact managed live table marker.'
    )
    return undefined
  }
  context.existingTableNames.add(table.name)
  return table
}

function statementTableName(context: RenderContext, entityId: string, liveName: string): string {
  return context.renamedTables.get(entityId) ?? liveName
}

function targetField(entity: DataEntityIR, fieldId: string): DataFieldIR | undefined {
  return entity.fields.find((entry) => entry.id === fieldId)
}

function liveColumn(
  context: RenderContext,
  tableName: string,
  fieldId: string
): SupabaseInspectedMigrationSnapshotV1['columns'][number] | undefined {
  return context.snapshot.columns.find(
    (entry) =>
      entry.tableName === tableName &&
      entry.management === 'managed' &&
      entry.openPencilFieldId === fieldId
  )
}

function sameFieldShape(left: DataFieldIR, right: DataFieldIR): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.type === right.type &&
    (left.enumId ?? null) === (right.enumId ?? null)
  )
}

function physicalIndexName(entity: DataEntityIR, index: DataIndexIR): string {
  const fields = namesForFields(entity, index.fields)
  return stableSQLName(
    'openpencil_idx',
    `${entity.name}:${fields.join(',')}:${index.order ?? 'asc'}`
  )
}

function physicalUniqueName(entity: DataEntityIR, unique: DataUniqueIR): string {
  return stableSQLName(
    'openpencil_uq',
    `${entity.name}:${namesForFields(entity, unique.fields).join(',')}`
  )
}

function physicalForeignKeyName(
  entity: DataEntityIR,
  foreignKey: DataForeignKeyIR,
  target: DataEntityIR
): string {
  return stableSQLName(
    'openpencil_fk',
    `${entity.name}:${namesForFields(entity, foreignKey.fields).join(',')}->${target.name}:${namesForFields(target, foreignKey.targetFields).join(',')}:${foreignKey.onDelete}`
  )
}

function foreignKeyAction(action: DataForeignKeyIR['onDelete']): string {
  switch (action) {
    case 'restrict':
      return 'RESTRICT'
    case 'cascade':
      return 'CASCADE'
    case 'set-null':
      return 'SET NULL'
    case 'no-action':
      return 'NO ACTION'
  }
  throw new TypeError('Unsupported foreign-key delete action.')
}

function matchingForeignKeyIndex(
  entity: DataEntityIR,
  foreignKey: DataForeignKeyIR
): DataIndexIR | undefined {
  return [...(entity.indexes ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .find(
      (index) =>
        index.fields.length >= foreignKey.fields.length &&
        foreignKey.fields.every((field, indexPosition) => index.fields[indexPosition] === field)
    )
}

function renderSupportingIndex(
  context: RenderContext,
  entity: DataEntityIR,
  tableName: string,
  index: DataIndexIR,
  path: string
): readonly string[] {
  if (context.renderedIndexIds.has(index.id)) return []
  context.renderedIndexIds.add(index.id)
  const fields = namesForFields(entity, index.fields)
  const order = index.order ? ` ${index.order.toUpperCase()}` : ''
  const name = physicalIndexName(entity, index)
  const inspected = context.snapshot.indexes.find(
    (entry) => entry.management === 'managed' && entry.openPencilId === index.id
  )
  if (inspected) {
    const exactFields =
      inspected.tableName === tableName &&
      inspected.fields.length === fields.length &&
      inspected.fields.every(
        (field, fieldIndex) =>
          field.name === fields[fieldIndex] && field.order === (index.order ?? 'asc')
      )
    if (!exactFields) {
      addBlocker(
        context.blockers,
        'supabase-staged-index-binding-mismatch',
        path,
        'The managed live index marker does not match the target physical index fields.'
      )
    }
    return []
  }
  if (context.snapshot.indexes.some((entry) => entry.name === name)) {
    addBlocker(
      context.blockers,
      'supabase-staged-index-name-collision',
      path,
      'A live index occupies the deterministic physical index name.'
    )
    return []
  }
  return [
    `CREATE INDEX ${quoteIdentifier(name)} ON ${qualified(tableName)} (${fields
      .map((field) => `${quoteIdentifier(field)}${order}`)
      .join(', ')});`,
    `COMMENT ON INDEX ${qualified(name)} IS ${markerLiteral('index', index.id)};`
  ]
}

function renderAddNullableField(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'add-nullable-field' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  const target = targetField(entity, operation.field.id)
  if (!target || !sameFieldShape(operation.field, target)) {
    addBlocker(
      context.blockers,
      'supabase-staged-field-target-binding-mismatch',
      path,
      'The staged nullable field does not match the target physical field identity and shape.'
    )
    return []
  }
  if (operation.field.default?.kind === 'generated') {
    addBlocker(
      context.blockers,
      'supabase-staged-generated-default-operation-required',
      `${path}.field.default`,
      'Generated defaults require an explicit set-generated-default staged operation.'
    )
    return []
  }
  if (
    liveColumn(context, table.name, operation.field.id) ||
    context.snapshot.columns.some(
      (entry) => entry.tableName === table.name && entry.name === operation.field.name
    )
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-field-live-collision',
      path,
      'The staged field collides with an inspected live column identity or name.'
    )
    return []
  }
  const definition = fieldDefinition(context.application, entity, operation.field, context.blockers)
  if (!definition) return []
  return [
    `ALTER TABLE ${qualified(table.name)} ADD COLUMN ${definition};`,
    `COMMENT ON COLUMN ${qualified(table.name)}.${quoteIdentifier(operation.field.name)} IS ${markerLiteral('field', operation.field.id)};`
  ]
}

function renderAddForeignKey(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'add-foreign-key' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  const foreignKey = (entity.foreignKeys ?? []).find(
    (entry) => entry.id === operation.foreignKey.id
  )
  if (!foreignKey || JSON.stringify(foreignKey) !== JSON.stringify(operation.foreignKey)) {
    addBlocker(
      context.blockers,
      'supabase-staged-foreign-key-target-binding-mismatch',
      path,
      'The staged foreign key does not exactly match the target DataModelIR.'
    )
    return []
  }
  const target = targetEntity(
    context,
    foreignKey.targetEntityId,
    `${path}.foreignKey.targetEntityId`
  )
  const targetTable = liveTable(
    context,
    foreignKey.targetEntityId,
    `${path}.foreignKey.targetEntityId`
  )
  const index = matchingForeignKeyIndex(entity, foreignKey)
  if (!target || !targetTable || !index) {
    if (!index) {
      addBlocker(
        context.blockers,
        'supabase-staged-foreign-key-index-required',
        path,
        'A staged foreign key requires an explicit leading target index rendered in the same phase.'
      )
    }
    return []
  }
  if (table.name !== entity.name || targetTable.name !== target.name) {
    addBlocker(
      context.blockers,
      'supabase-staged-foreign-key-physical-name-mismatch',
      path,
      'Foreign-key expand requires the inspected and target physical table names to match.'
    )
    return []
  }
  const existing = context.snapshot.constraints.find(
    (entry) =>
      entry.kind === 'foreign-key' &&
      entry.management === 'managed' &&
      entry.openPencilId === foreignKey.id
  )
  if (existing) {
    addBlocker(
      context.blockers,
      'supabase-staged-foreign-key-already-present',
      path,
      'The staged foreign key is already present in the inspected baseline.'
    )
    return []
  }
  const fields = namesForFields(entity, foreignKey.fields)
  const targetFields = namesForFields(target, foreignKey.targetFields)
  const name = physicalForeignKeyName(entity, foreignKey, target)
  return [
    ...renderSupportingIndex(context, entity, table.name, index, path),
    `ALTER TABLE ${qualified(table.name)} ADD CONSTRAINT ${quoteIdentifier(name)} FOREIGN KEY (${fields.map(quoteIdentifier).join(', ')}) REFERENCES ${qualified(targetTable.name)} (${targetFields.map(quoteIdentifier).join(', ')}) ON DELETE ${foreignKeyAction(foreignKey.onDelete)} NOT VALID;`,
    `COMMENT ON CONSTRAINT ${quoteIdentifier(name)} ON ${qualified(table.name)} IS ${markerLiteral('foreign-key', foreignKey.id)};`
  ]
}

function renderAddUnique(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'add-unique' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  const unique = (entity.uniques ?? []).find((entry) => entry.id === operation.unique.id)
  if (!unique || JSON.stringify(unique) !== JSON.stringify(operation.unique)) {
    addBlocker(
      context.blockers,
      'supabase-staged-unique-target-binding-mismatch',
      path,
      'The staged unique constraint does not exactly match the target DataModelIR.'
    )
    return []
  }
  if (table.name !== entity.name) {
    addBlocker(
      context.blockers,
      'supabase-staged-unique-physical-name-mismatch',
      path,
      'Unique expand requires the inspected and target physical table names to match.'
    )
    return []
  }
  if (
    context.snapshot.constraints.some(
      (entry) => entry.management === 'managed' && entry.openPencilId === unique.id
    )
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-unique-already-present',
      path,
      'The staged unique constraint is already present in the inspected baseline.'
    )
    return []
  }
  const fields = namesForFields(entity, unique.fields)
  const name = physicalUniqueName(entity, unique)
  return [
    // PostgreSQL has no UNIQUE NOT VALID form. This is deliberately high-risk, reviewed SQL: the
    // constraint validates existing rows while the baseline transaction holds an exclusive lock.
    `ALTER TABLE ${qualified(table.name)} ADD CONSTRAINT ${quoteIdentifier(name)} UNIQUE (${fields.map(quoteIdentifier).join(', ')});`,
    `COMMENT ON CONSTRAINT ${quoteIdentifier(name)} ON ${qualified(table.name)} IS ${markerLiteral('unique', unique.id)};`
  ]
}

function plannedAddedField(
  context: RenderContext,
  entityId: string,
  fieldId: string
): DataFieldIR | undefined {
  for (const entry of context.plan.operations) {
    const operation = entry.operation
    if (
      operation.kind === 'add-nullable-field' &&
      operation.entityId === entityId &&
      operation.field.id === fieldId
    ) {
      return operation.field
    }
  }
  return undefined
}

function renderSetGeneratedDefault(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'set-generated-default' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  const field = targetField(entity, operation.fieldId)
  const expectedDefault = field?.default
  if (
    !field ||
    field.type !== operation.fieldType ||
    expectedDefault?.kind !== 'generated' ||
    expectedDefault.generator !== operation.generator
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-generated-default-target-binding-mismatch',
      path,
      'The staged generated default does not exactly match the target field intent.'
    )
    return []
  }
  const inspected = liveColumn(context, table.name, field.id)
  const added = plannedAddedField(context, entity.id, field.id)
  if (!inspected && !added) {
    addBlocker(
      context.blockers,
      'supabase-staged-generated-default-field-binding-required',
      path,
      'The generated default field is neither inspected nor added by this staged plan.'
    )
    return []
  }
  if (inspected && (inspected.type !== field.type || inspected.name !== field.name)) {
    addBlocker(
      context.blockers,
      'supabase-staged-generated-default-field-binding-mismatch',
      path,
      'The inspected generated-default field has a different physical name or type.'
    )
    return []
  }
  if (inspected && inspected.default !== null) {
    addBlocker(
      context.blockers,
      'supabase-staged-generated-default-live-default-present',
      path,
      'The inspected field already has a default; implicit replacement is forbidden.'
    )
    return []
  }
  if (operation.generator === 'uuid') {
    return [
      `ALTER TABLE ${qualified(table.name)} ALTER COLUMN ${quoteIdentifier(field.name)} SET DEFAULT pg_catalog.gen_random_uuid();`
    ]
  }
  if (!inspected || inspected.nullable || added) {
    addBlocker(
      context.blockers,
      'supabase-staged-identity-non-null-source-required',
      path,
      'PostgreSQL can add identity only to an existing NOT NULL column; nullable-field expansion requires a separately reviewed sequence/backfill/contract plan.'
    )
    return []
  }
  const tableReference = quoteLiteral(qualified(table.name))
  const fieldName = quoteIdentifier(field.name)
  return [
    `ALTER TABLE ${qualified(table.name)} ALTER COLUMN ${fieldName} ADD GENERATED BY DEFAULT AS IDENTITY;`,
    `DO $openpencil_identity_sequence$
DECLARE
  identity_sequence regclass;
  next_identity numeric;
BEGIN
  identity_sequence := pg_catalog.pg_get_serial_sequence(${tableReference}, ${quoteLiteral(field.name)})::regclass;
  IF identity_sequence IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil identity sequence binding failed for ${table.name}.${field.name}.',
      ERRCODE = 'P0001';
  END IF;
  SELECT GREATEST(COALESCE(pg_catalog.max(${fieldName})::numeric, 0), 0) + 1
  INTO next_identity
  FROM ${qualified(table.name)};
  IF next_identity > 9223372036854775807::numeric THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil identity sequence exhausted for ${table.name}.${field.name}.',
      ERRCODE = '22003';
  END IF;
  PERFORM pg_catalog.setval(identity_sequence, next_identity::bigint, false);
END
$openpencil_identity_sequence$;`
  ]
}

function literalSQL(
  context: RenderContext,
  field: DataFieldIR,
  literal: StagedMigrationTypedLiteralV1,
  path: string
): string | undefined {
  if (
    field.type !== literal.fieldType ||
    (field.type === 'enum' && field.enumId !== literal.enumId)
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-backfill-literal-type-mismatch',
      path,
      'The typed backfill literal does not match the target field type.'
    )
    return undefined
  }
  if (literal.value === null) {
    addBlocker(
      context.blockers,
      'supabase-staged-backfill-null-blocked',
      path,
      'A null backfill cannot establish a later non-null invariant.'
    )
    return undefined
  }
  switch (field.type) {
    case 'string':
      return quoteLiteral(String(literal.value))
    case 'integer':
      return `${String(literal.value)}::bigint`
    case 'number':
      return `${String(literal.value)}::double precision`
    case 'boolean':
      return literal.value ? 'TRUE' : 'FALSE'
    case 'date':
      return `${quoteLiteral(String(literal.value))}::date`
    case 'datetime':
      return `${quoteLiteral(String(literal.value))}::timestamp with time zone`
    case 'uuid':
      return `${quoteLiteral(String(literal.value))}::uuid`
    case 'json':
      return `${quoteLiteral(JSON.stringify(literal.value))}::jsonb`
    case 'enum': {
      const dataEnum = context.application.dataModel.enums.find(
        (entry) => entry.id === field.enumId
      )
      if (!dataEnum || !dataEnum.values.includes(String(literal.value))) {
        addBlocker(
          context.blockers,
          'supabase-staged-backfill-enum-binding-mismatch',
          path,
          'The typed enum backfill is not a declared value of the bound physical enum.'
        )
        return undefined
      }
      return `${quoteLiteral(String(literal.value))}::${qualified(dataEnum.name)}`
    }
    case 'bytes':
      addBlocker(
        context.blockers,
        'supabase-staged-backfill-bytes-unsupported',
        path,
        'Byte backfills require an explicit provider encoding contract.'
      )
      return undefined
  }
  throw new TypeError('Unsupported staged backfill field type.')
}

function renderBackfillField(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'backfill-field' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  const field = targetField(entity, operation.fieldId)
  const column = liveColumn(context, table.name, operation.fieldId)
  if (
    !field ||
    !column ||
    column.name !== field.name ||
    column.type !== field.type ||
    (field.type === 'enum' &&
      column.enumName !==
        context.application.dataModel.enums.find((entry) => entry.id === field.enumId)?.name)
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-backfill-field-binding-mismatch',
      path,
      'Backfill requires an exact managed live field identity, name, and type binding.'
    )
    return []
  }
  const value = literalSQL(context, field, operation.value, `${path}.value`)
  if (!value) return []
  return [
    `UPDATE ${qualified(table.name)} SET ${quoteIdentifier(field.name)} = ${value} WHERE ${quoteIdentifier(field.name)} IS NULL;`
  ]
}

function exactForeignKeyConstraint(
  context: RenderContext,
  entity: DataEntityIR,
  tableName: string,
  foreignKey: DataForeignKeyIR,
  path: string
) {
  const target = targetEntity(context, foreignKey.targetEntityId, `${path}.targetEntityId`)
  if (!target) return undefined
  const expectedFields = namesForFields(entity, foreignKey.fields)
  const expectedTargetFields = namesForFields(target, foreignKey.targetFields)
  const constraint = context.snapshot.constraints.find(
    (entry) =>
      entry.kind === 'foreign-key' &&
      entry.management === 'managed' &&
      entry.openPencilId === foreignKey.id
  )
  if (
    constraint?.kind !== 'foreign-key' ||
    constraint.tableName !== tableName ||
    constraint.targetTableName !== target.name ||
    constraint.onDelete !== foreignKey.onDelete ||
    JSON.stringify(constraint.fields) !== JSON.stringify(expectedFields) ||
    JSON.stringify(constraint.targetFields) !== JSON.stringify(expectedTargetFields)
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-foreign-key-live-binding-mismatch',
      path,
      'Foreign-key validation requires an exact managed live constraint shape and marker.'
    )
    return undefined
  }
  return constraint
}

function renderValidateForeignKey(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'validate-foreign-key' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  const foreignKey = entity?.foreignKeys?.find((entry) => entry.id === operation.foreignKeyId)
  if (!entity || !table || !foreignKey) {
    if (entity && !foreignKey) {
      addBlocker(
        context.blockers,
        'supabase-staged-foreign-key-target-binding-mismatch',
        path,
        'The validation operation does not reference a target foreign key.'
      )
    }
    return []
  }
  const constraint = exactForeignKeyConstraint(context, entity, table.name, foreignKey, path)
  return constraint
    ? [
        `ALTER TABLE ${qualified(table.name)} VALIDATE CONSTRAINT ${quoteIdentifier(constraint.name)};`
      ]
    : []
}

function exactUniqueConstraint(
  context: RenderContext,
  entity: DataEntityIR,
  tableName: string,
  unique: DataUniqueIR,
  path: string
) {
  const fields = namesForFields(entity, unique.fields)
  const constraint = context.snapshot.constraints.find(
    (entry) =>
      entry.kind === 'unique' && entry.management === 'managed' && entry.openPencilId === unique.id
  )
  if (
    constraint?.kind !== 'unique' ||
    constraint.tableName !== tableName ||
    JSON.stringify(constraint.fields) !== JSON.stringify(fields)
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-unique-live-binding-mismatch',
      path,
      'Unique validation requires an exact managed live constraint shape and marker.'
    )
    return undefined
  }
  return constraint
}

function renderValidateUnique(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'validate-unique' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  const unique = entity?.uniques?.find((entry) => entry.id === operation.uniqueId)
  if (!entity || !table || !unique) {
    if (entity && !unique) {
      addBlocker(
        context.blockers,
        'supabase-staged-unique-target-binding-mismatch',
        path,
        'The validation operation does not reference a target unique constraint.'
      )
    }
    return []
  }
  const constraint = exactUniqueConstraint(context, entity, table.name, unique, path)
  if (!constraint) return []
  return [
    `DO $openpencil_validate_unique$
DECLARE
  constraint_validated boolean;
BEGIN
  SELECT constraint_record.convalidated
  INTO constraint_validated
  FROM pg_catalog.pg_constraint AS constraint_record
  JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = ${quoteLiteral(table.name)}
    AND constraint_record.conname = ${quoteLiteral(constraint.name)}
    AND constraint_record.contype = 'u'::"char"
    AND pg_catalog.obj_description(constraint_record.oid, 'pg_constraint') IS NOT DISTINCT FROM ${quoteLiteral(formatSupabaseManagedMarker('unique', unique.id))};

  IF constraint_validated IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil unique validation failed for ${table.name}.${constraint.name}.',
      ERRCODE = 'P0001';
  END IF;
END
$openpencil_validate_unique$;`
  ]
}

function renderRenameEntity(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'rename-entity' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  if (!entity || !table) return []
  if (
    table.name !== operation.fromName ||
    entity.name !== operation.toName ||
    context.snapshot.objects.some((entry) => entry.name === operation.toName && entry !== table)
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-entity-rename-binding-mismatch',
      path,
      'Entity rename endpoints do not match the inspected source and target physical names.'
    )
    return []
  }
  return [
    `ALTER TABLE ${qualified(operation.fromName)} RENAME TO ${quoteIdentifier(operation.toName)};`
  ]
}

function renderRenameField(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'rename-field' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  const field = entity ? targetField(entity, operation.fieldId) : undefined
  const column = table ? liveColumn(context, table.name, operation.fieldId) : undefined
  if (
    !entity ||
    !table ||
    !field ||
    !column ||
    column.name !== operation.fromName ||
    field.name !== operation.toName ||
    context.snapshot.columns.some(
      (entry) =>
        entry.tableName === table.name &&
        entry.name === operation.toName &&
        entry.openPencilFieldId !== operation.fieldId
    )
  ) {
    addBlocker(
      context.blockers,
      'supabase-staged-field-rename-binding-mismatch',
      path,
      'Field rename endpoints do not match the inspected source and target physical names.'
    )
    return []
  }
  return [
    `ALTER TABLE ${qualified(statementTableName(context, entity.id, table.name))} RENAME COLUMN ${quoteIdentifier(operation.fromName)} TO ${quoteIdentifier(operation.toName)};`
  ]
}

function renderSetNotNull(
  context: RenderContext,
  operation: Extract<StagedMigrationOperationV1, { kind: 'set-not-null' }>
): readonly string[] {
  const path = operationPath(operation)
  const entity = targetEntity(context, operation.entityId, path)
  const table = liveTable(context, operation.entityId, path)
  const field = entity ? targetField(entity, operation.fieldId) : undefined
  const column = table ? liveColumn(context, table.name, operation.fieldId) : undefined
  if (!entity || !table || !field || !column || field.nullable || !column.nullable) {
    addBlocker(
      context.blockers,
      'supabase-staged-not-null-binding-mismatch',
      path,
      'SET NOT NULL requires an inspected nullable source field and a non-null target field.'
    )
    return []
  }
  const tableName = statementTableName(context, entity.id, table.name)
  const fieldName = context.renamedFields.get(`${entity.id}:${field.id}`) ?? column.name
  return [
    `DO $openpencil_not_null$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ${qualified(tableName)} WHERE ${quoteIdentifier(fieldName)} IS NULL
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil non-null validation failed for ${tableName}.${fieldName}.',
      ERRCODE = '23502';
  END IF;
END
$openpencil_not_null$;`,
    `ALTER TABLE ${qualified(tableName)} ALTER COLUMN ${quoteIdentifier(fieldName)} SET NOT NULL;`
  ]
}

function renderOperation(
  context: RenderContext,
  operation: StagedMigrationOperationV1
): readonly string[] {
  switch (operation.kind) {
    case 'apply-reviewed-migration':
      addBlocker(
        context.blockers,
        'supabase-reviewed-migration-authority-host-derived-only',
        operationPath(operation),
        'Reviewed source SQL authority is derived only after an ordinary review is reproduced and bundled.'
      )
      return []
    case 'add-nullable-field':
      return renderAddNullableField(context, operation)
    case 'add-foreign-key':
      return renderAddForeignKey(context, operation)
    case 'add-unique':
      return renderAddUnique(context, operation)
    case 'set-generated-default':
      return renderSetGeneratedDefault(context, operation)
    case 'backfill-field':
      return renderBackfillField(context, operation)
    case 'validate-foreign-key':
      return renderValidateForeignKey(context, operation)
    case 'validate-unique':
      return renderValidateUnique(context, operation)
    case 'rename-entity':
      return renderRenameEntity(context, operation)
    case 'rename-field':
      return renderRenameField(context, operation)
    case 'set-not-null':
      return renderSetNotNull(context, operation)
    case 'retire-field':
    case 'retire-entity':
      addBlocker(
        context.blockers,
        'supabase-staged-destructive-operation-approval-required',
        operationPath(operation),
        'Destructive staged SQL requires an independent human approval and recovery authority.'
      )
      return []
  }
  throw new TypeError('Unsupported staged migration operation.')
}

function operationPriority(operation: StagedMigrationOperationV1): number {
  switch (operation.kind) {
    case 'apply-reviewed-migration':
      return 0
    case 'add-nullable-field':
      return 0
    case 'set-generated-default':
      return 1
    case 'add-unique':
      return 2
    case 'add-foreign-key':
      return 3
    case 'backfill-field':
      return 0
    case 'validate-foreign-key':
    case 'validate-unique':
      return 1
    case 'rename-entity':
      return 0
    case 'rename-field':
      return 1
    case 'set-not-null':
      return 2
    case 'retire-field':
    case 'retire-entity':
      return 3
  }
  throw new TypeError('Unsupported staged migration operation.')
}

export function renderStagedMigrations(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  plan: StagedMigrationExecutionPlanV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): StagedMigrationSQLResult {
  const renamedTables = new Map<string, string>()
  const renamedFields = new Map<string, string>()
  for (const entry of plan.operations) {
    if (entry.operation.kind === 'rename-entity') {
      renamedTables.set(entry.operation.entityId, entry.operation.toName)
    }
    if (entry.operation.kind === 'rename-field') {
      renamedFields.set(
        `${entry.operation.entityId}:${entry.operation.fieldId}`,
        entry.operation.toName
      )
    }
  }
  const context: RenderContext = {
    application,
    snapshot,
    plan,
    blockers,
    existingTableNames: new Set<string>(),
    renamedTables,
    renamedFields,
    renderedIndexIds: new Set<string>()
  }
  const operations = [...plan.operations]
    .map((entry) => entry.operation)
    .sort(
      (left, right) =>
        operationPriority(left) - operationPriority(right) || left.id.localeCompare(right.id, 'en')
    )
  const statements = operations.flatMap((operation) => renderOperation(context, operation))
  return {
    statements,
    operationIds: operations
      .map((operation) => operation.id)
      .sort((left, right) => left.localeCompare(right, 'en')),
    existingTableNames: [...context.existingTableNames].sort((left, right) =>
      left.localeCompare(right, 'en')
    )
  }
}
