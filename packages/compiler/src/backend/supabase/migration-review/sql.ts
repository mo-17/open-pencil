import type {
  BackendApplicationSpecV1,
  BackendFieldDefault,
  DataEntityIR,
  DataFieldIR,
  MigrationPlan
} from '@open-pencil/lowcode/backend'

import {
  formatSupabaseManagedMarker,
  type SupabaseInspectedMigrationSnapshotV1,
  type SupabaseManagedMarkerKind
} from '../inspection'
import { addBlocker, qualified, quoteIdentifier, quoteLiteral, stableSQLName } from './common'
import type { SupabaseMigrationReviewBlockerV1 } from './contract'

function literalSQL(value: string | number | boolean | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return quoteLiteral(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function fieldTypeSQL(
  application: BackendApplicationSpecV1,
  field: DataFieldIR,
  path: string,
  blockers: SupabaseMigrationReviewBlockerV1[]
): string | undefined {
  switch (field.type) {
    case 'string':
      return 'text'
    case 'integer':
      return 'bigint'
    case 'number':
      return 'double precision'
    case 'boolean':
      return 'boolean'
    case 'date':
      return 'date'
    case 'datetime':
      return 'timestamp with time zone'
    case 'uuid':
      return 'uuid'
    case 'json':
      return 'jsonb'
    case 'bytes':
      return 'bytea'
    case 'enum': {
      const dataEnum = application.dataModel.enums.find((entry) => entry.id === field.enumId)
      if (dataEnum) return qualified(dataEnum.name)
      addBlocker(
        blockers,
        'supabase-migration-enum-binding-required',
        path,
        'Enum field lacks an exact target enum identity.'
      )
      return undefined
    }
    default: {
      const exhaustive: never = field.type
      throw new TypeError(`Unsupported field type ${String(exhaustive)}`)
    }
  }
}

function defaultSQL(
  field: DataFieldIR,
  fieldDefault: BackendFieldDefault | undefined,
  path: string,
  blockers: SupabaseMigrationReviewBlockerV1[]
): string {
  if (!fieldDefault) return ''
  if (fieldDefault.kind === 'literal') {
    if (field.type === 'bytes') {
      addBlocker(
        blockers,
        'supabase-migration-bytes-literal-unsupported',
        path,
        'Byte literals require a reviewed provider encoding and are not inferred.'
      )
      return ''
    }
    if (field.type === 'json') {
      return ` DEFAULT ${quoteLiteral(JSON.stringify(fieldDefault.value))}::jsonb`
    }
    return ` DEFAULT ${literalSQL(fieldDefault.value)}`
  }
  switch (fieldDefault.generator) {
    case 'uuid':
      if (field.type !== 'uuid') {
        addBlocker(
          blockers,
          'supabase-migration-generated-default-type-mismatch',
          path,
          'UUID generation requires a UUID field.'
        )
        return ''
      }
      addBlocker(
        blockers,
        'supabase-migration-uuid-generator-inspection-required',
        path,
        'UUID generation requires an exact inspected function or extension binding.'
      )
      return ''
    case 'identity':
      if (field.type !== 'integer') {
        addBlocker(
          blockers,
          'supabase-migration-generated-default-type-mismatch',
          path,
          'Identity generation requires an integer field.'
        )
        return ''
      }
      addBlocker(
        blockers,
        'supabase-migration-identity-sequence-review-required',
        path,
        'Identity generation requires an exact sequence ownership and privilege review.'
      )
      return ''
    case 'created-at':
      if (field.type !== 'date' && field.type !== 'datetime') {
        addBlocker(
          blockers,
          'supabase-migration-generated-default-type-mismatch',
          path,
          'Created-at generation requires a date or datetime field.'
        )
        return ''
      }
      return ' DEFAULT CURRENT_TIMESTAMP'
    case 'updated-at':
      addBlocker(
        blockers,
        'supabase-migration-updated-at-trigger-review-required',
        path,
        'Updated-at semantics require a reviewed trigger and are not inferred.'
      )
      return ''
    default: {
      const exhaustive: never = fieldDefault.generator
      throw new TypeError(`Unsupported generated default ${String(exhaustive)}`)
    }
  }
}

function fieldDefinition(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  field: DataFieldIR,
  blockers: SupabaseMigrationReviewBlockerV1[]
): string | undefined {
  const path = `$.targetModel.entities.${entity.id}.fields.${field.id}`
  const type = fieldTypeSQL(application, field, path, blockers)
  if (!type) return undefined
  const defaultClause = defaultSQL(field, field.default, `${path}.default`, blockers)
  return `${quoteIdentifier(field.name)} ${type}${defaultClause}${field.nullable ? '' : ' NOT NULL'}`
}

function namesForFields(entity: DataEntityIR, fieldIds: readonly string[]): readonly string[] {
  return fieldIds.map((fieldId) => {
    const field = entity.fields.find((entry) => entry.id === fieldId)
    if (!field) throw new TypeError(`Normalized entity ${entity.id} is missing field ${fieldId}`)
    return field.name
  })
}

function markerLiteral(kind: SupabaseManagedMarkerKind, id: string): string {
  return quoteLiteral(formatSupabaseManagedMarker(kind, id))
}

function addEnumRenameBlockers(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const currentEnum of snapshot.currentModel.enums) {
    const targetEnum = application.dataModel.enums.find((entry) => entry.id === currentEnum.id)
    if (targetEnum && targetEnum.name !== currentEnum.name) {
      addBlocker(
        blockers,
        'supabase-migration-enum-rename-unplanned',
        `$.targetModel.enums.${currentEnum.id}.name`,
        'Shared migration planning does not represent enum rename; SQL emission is blocked.'
      )
    }
  }
}

function addUnsupportedOperationBlockers(
  plan: MigrationPlan,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  for (const entry of plan.operations) {
    if (
      entry.operation.kind !== 'create-enum' &&
      entry.operation.kind !== 'create-entity' &&
      entry.operation.kind !== 'add-enum-value' &&
      entry.operation.kind !== 'add-field' &&
      entry.operation.kind !== 'add-index'
    ) {
      addBlocker(
        blockers,
        'supabase-migration-operation-unsupported',
        `$.migrationPlan.operations.${entry.operation.id}`,
        `Migration operation ${entry.operation.kind} is not in the proven additive SQL subset.`
      )
    }
  }
}

function addEnumValueTransactionBoundaryBlocker(
  plan: MigrationPlan,
  blockers: SupabaseMigrationReviewBlockerV1[]
): void {
  const extendsEnum = plan.operations.some((entry) => entry.operation.kind === 'add-enum-value')
  const hasOtherOperation = plan.operations.some(
    (entry) => entry.operation.kind !== 'add-enum-value'
  )
  if (!extendsEnum || !hasOtherOperation) return
  addBlocker(
    blockers,
    'supabase-migration-enum-value-transaction-boundary-required',
    '$.migrationPlan.operations',
    'PostgreSQL enum values cannot be safely consumed before their adding transaction commits; review enum extension as a dedicated migration.'
  )
}

function hasLiveNameCollision(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  name: string
): boolean {
  return snapshot.objects.some((object) => object.name === name)
}

function renderCreateEnum(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entry: MigrationPlan['operations'][number],
  blockers: SupabaseMigrationReviewBlockerV1[]
): readonly string[] | null {
  if (entry.operation.kind !== 'create-enum') return null
  const dataEnum = entry.operation.enum
  if (hasLiveNameCollision(snapshot, dataEnum.name)) {
    addBlocker(
      blockers,
      'supabase-migration-live-name-collision',
      `$.migrationPlan.operations.${entry.operation.id}`,
      'Enum creation collides with an inspected live object.'
    )
    return null
  }
  return [
    `CREATE TYPE ${qualified(dataEnum.name)} AS ENUM (${dataEnum.values.map(quoteLiteral).join(', ')});`,
    `REVOKE USAGE ON TYPE ${qualified(dataEnum.name)} FROM PUBLIC;`,
    `COMMENT ON TYPE ${qualified(dataEnum.name)} IS ${markerLiteral('enum', dataEnum.id)};`
  ]
}

function renderCreateEntity(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entry: MigrationPlan['operations'][number],
  blockers: SupabaseMigrationReviewBlockerV1[]
): readonly string[] | null {
  if (entry.operation.kind !== 'create-entity') return null
  const entity = entry.operation.entity
  if (hasLiveNameCollision(snapshot, entity.name)) {
    addBlocker(
      blockers,
      'supabase-migration-live-name-collision',
      `$.migrationPlan.operations.${entry.operation.id}`,
      'Table creation collides with an inspected live object.'
    )
    return null
  }
  if ((entity.foreignKeys?.length ?? 0) > 0) {
    addBlocker(
      blockers,
      'supabase-migration-foreign-key-order-review-required',
      `$.migrationPlan.operations.${entry.operation.id}.entity.foreignKeys`,
      'Foreign key dependency order and supporting indexes require explicit review.'
    )
    return null
  }
  const definitions = entity.fields
    .map((field) => fieldDefinition(application, entity, field, blockers))
    .filter(Boolean)
  const constraintComments: string[] = []
  if (entity.primaryKey) {
    const name = stableSQLName('openpencil_pk', `${entity.id}:primary-key`)
    definitions.push(
      `CONSTRAINT ${quoteIdentifier(name)} PRIMARY KEY (${namesForFields(entity, entity.primaryKey.fields).map(quoteIdentifier).join(', ')})`
    )
    constraintComments.push(
      `COMMENT ON CONSTRAINT ${quoteIdentifier(name)} ON ${qualified(entity.name)} IS ${markerLiteral('primary-key', entity.id)};`
    )
  }
  for (const unique of [...(entity.uniques ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id, 'en')
  )) {
    const name = stableSQLName('openpencil_uq', `${entity.id}:${unique.id}`)
    definitions.push(
      `CONSTRAINT ${quoteIdentifier(name)} UNIQUE (${namesForFields(entity, unique.fields).map(quoteIdentifier).join(', ')})`
    )
    constraintComments.push(
      `COMMENT ON CONSTRAINT ${quoteIdentifier(name)} ON ${qualified(entity.name)} IS ${markerLiteral('unique', unique.id)};`
    )
  }
  const statements = [
    `CREATE TABLE ${qualified(entity.name)} (\n  ${definitions.join(',\n  ')}\n);`,
    `COMMENT ON TABLE ${qualified(entity.name)} IS ${markerLiteral('entity', entity.id)};`,
    ...entity.fields.map(
      (field) =>
        `COMMENT ON COLUMN ${qualified(entity.name)}.${quoteIdentifier(field.name)} IS ${markerLiteral('field', field.id)};`
    ),
    ...constraintComments
  ]
  for (const index of [...(entity.indexes ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id, 'en')
  )) {
    const name = stableSQLName('openpencil_idx', `${entity.id}:${index.id}`)
    const order = index.order ? ` ${index.order.toUpperCase()}` : ''
    statements.push(
      `CREATE INDEX ${quoteIdentifier(name)} ON ${qualified(entity.name)} (${namesForFields(
        entity,
        index.fields
      )
        .map((field) => `${quoteIdentifier(field)}${order}`)
        .join(', ')});`
    )
    statements.push(`COMMENT ON INDEX ${qualified(name)} IS ${markerLiteral('index', index.id)};`)
  }
  return statements
}

function managedObjectById(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  kind: 'table' | 'enum',
  id: string
) {
  return snapshot.objects.find(
    (object) =>
      object.kind === kind && object.management === 'managed' && object.openPencilId === id
  )
}

function renderAddEnumValue(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entry: MigrationPlan['operations'][number],
  blockers: SupabaseMigrationReviewBlockerV1[]
): string | null {
  if (entry.operation.kind !== 'add-enum-value') return null
  const dataEnum = managedObjectById(snapshot, 'enum', entry.operation.enumId)
  if (dataEnum?.kind !== 'enum') {
    addBlocker(
      blockers,
      'supabase-migration-live-enum-binding-required',
      `$.migrationPlan.operations.${entry.operation.id}`,
      'Enum extension requires an exact managed live enum marker.'
    )
    return null
  }
  return `ALTER TYPE ${qualified(dataEnum.name)} ADD VALUE ${quoteLiteral(entry.operation.value)};`
}

function targetEntity(
  application: BackendApplicationSpecV1,
  entityId: string
): DataEntityIR | undefined {
  return application.dataModel.entities.find(
    (entity) => entity.id === entityId && entity.management === 'managed'
  )
}

function requireManagedLiveTable(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entity: DataEntityIR | undefined,
  operationId: string,
  blockers: SupabaseMigrationReviewBlockerV1[]
): Extract<SupabaseInspectedMigrationSnapshotV1['objects'][number], { kind: 'table' }> | null {
  if (!entity) return null
  const table = managedObjectById(snapshot, 'table', entity.id)
  if (table?.kind !== 'table' || table.name !== entity.name) {
    addBlocker(
      blockers,
      'supabase-migration-live-table-binding-required',
      `$.migrationPlan.operations.${operationId}`,
      'Additive table change requires an exact managed live table marker and name.'
    )
    return null
  }
  return table
}

function renderAddField(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entry: MigrationPlan['operations'][number],
  blockers: SupabaseMigrationReviewBlockerV1[]
): readonly string[] | null {
  if (entry.operation.kind !== 'add-field') return null
  const entity = targetEntity(application, entry.operation.entityId)
  if (!requireManagedLiveTable(snapshot, entity, entry.operation.id, blockers) || !entity)
    return null
  if (!entry.operation.field.nullable) {
    addBlocker(
      blockers,
      'supabase-migration-add-field-not-null-blocked',
      `$.migrationPlan.operations.${entry.operation.id}`,
      'Only nullable field additions are in the proven additive SQL subset.'
    )
    return null
  }
  const definition = fieldDefinition(application, entity, entry.operation.field, blockers)
  if (!definition) return null
  return [
    `ALTER TABLE ${qualified(entity.name)} ADD COLUMN ${definition};`,
    `COMMENT ON COLUMN ${qualified(entity.name)}.${quoteIdentifier(entry.operation.field.name)} IS ${markerLiteral('field', entry.operation.field.id)};`
  ]
}

function renderAddIndex(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  entry: MigrationPlan['operations'][number],
  blockers: SupabaseMigrationReviewBlockerV1[]
): readonly string[] | null {
  if (entry.operation.kind !== 'add-index') return null
  const entity = targetEntity(application, entry.operation.entityId)
  if (!requireManagedLiveTable(snapshot, entity, entry.operation.id, blockers) || !entity)
    return null
  const index = entry.operation.index
  const name = stableSQLName('openpencil_idx', `${entity.id}:${index.id}`)
  const order = index.order ? ` ${index.order.toUpperCase()}` : ''
  return [
    `CREATE INDEX ${quoteIdentifier(name)} ON ${qualified(entity.name)} (${namesForFields(
      entity,
      index.fields
    )
      .map((field) => `${quoteIdentifier(field)}${order}`)
      .join(', ')});`,
    `COMMENT ON INDEX ${qualified(name)} IS ${markerLiteral('index', index.id)};`
  ]
}

export function renderAdditiveMigrations(
  application: BackendApplicationSpecV1,
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  plan: MigrationPlan,
  blockers: SupabaseMigrationReviewBlockerV1[]
): { readonly statements: readonly string[]; readonly operationIds: readonly string[] } {
  addEnumRenameBlockers(application, snapshot, blockers)
  addUnsupportedOperationBlockers(plan, blockers)
  addEnumValueTransactionBoundaryBlocker(plan, blockers)
  const statements: string[] = []
  const operationIds: string[] = []
  for (const entry of [...plan.operations].sort((left, right) =>
    left.operation.id.localeCompare(right.operation.id, 'en')
  )) {
    const enumStatements = renderCreateEnum(snapshot, entry, blockers)
    if (enumStatements) {
      statements.push(...enumStatements)
      operationIds.push(entry.operation.id)
      continue
    }
    const entityStatements = renderCreateEntity(application, snapshot, entry, blockers)
    if (entityStatements) {
      statements.push(...entityStatements)
      operationIds.push(entry.operation.id)
      continue
    }
    const enumValueStatement = renderAddEnumValue(snapshot, entry, blockers)
    if (enumValueStatement) {
      statements.push(enumValueStatement)
      operationIds.push(entry.operation.id)
      continue
    }
    const fieldStatements = renderAddField(application, snapshot, entry, blockers)
    if (fieldStatements) {
      statements.push(...fieldStatements)
      operationIds.push(entry.operation.id)
      continue
    }
    const indexStatements = renderAddIndex(application, snapshot, entry, blockers)
    if (indexStatements) {
      statements.push(...indexStatements)
      operationIds.push(entry.operation.id)
    }
  }
  return { statements, operationIds }
}
