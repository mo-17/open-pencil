/* eslint-disable max-lines -- Backend draft mutations stay co-located to share invariant checks. */
import {
  BACKEND_LIMITS,
  type AuthOwnershipIR,
  type AuthRoleIR,
  type AuthRowAccessIntentIR,
  type AuthTenantIR,
  type BackendApplicationSpecV1,
  type BackendStorageBucketIR,
  type BackendStoragePathRuleIR,
  type BackendStoragePrincipalIntent,
  type BackendWorkflowDefinitionIR,
  type BackendWorkflowStepIR,
  type DataEnumIR,
  type DataEntityIR,
  type DataFieldIR,
  type DataForeignKeyIR,
  type DataRelationIR
} from '@open-pencil/lowcode/backend'

export type BackendDraftIdFactory = (prefix: string) => string

export class BackendDraftOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendDraftOperationError'
  }
}

export const createBackendDraftId: BackendDraftIdFactory = (prefix) =>
  `${prefix}:${crypto.randomUUID()}`

const MAX_AUTH_ROLES = 128

function requireCapacity(current: number, maximum: number, label: string, addition = 1): void {
  if (current + addition > maximum) {
    throw new BackendDraftOperationError(`${label} is limited to ${maximum} items.`)
  }
}

function requireConstraintCapacity(entity: DataEntityIR, kind: string, addition = 1): void {
  let current = entity.indexes?.length ?? 0
  if (kind === 'foreign key') current = entity.foreignKeys?.length ?? 0
  else if (kind === 'unique constraint') current = entity.uniques?.length ?? 0
  requireCapacity(current, BACKEND_LIMITS.maxConstraintsPerEntity, kind, addition)
}

function safeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]/gu, '_')
    .replace(/_+/gu, '_')
  const prefixed = /^[A-Za-z_]/u.test(normalized) ? normalized : `_${normalized}`
  return (prefixed || fallback).slice(0, 63)
}

export function uniqueBackendIdentifier(
  preferred: string,
  existing: readonly string[],
  fallback = 'item'
): string {
  const used = new Set(existing)
  const base = safeIdentifier(preferred, fallback)
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 10_000; suffix++) {
    const marker = `_${suffix}`
    const candidate = `${base.slice(0, Math.max(1, 63 - marker.length))}${marker}`
    if (!used.has(candidate)) return candidate
  }
  throw new BackendDraftOperationError('Could not allocate a unique Backend identifier.')
}

function modelEntityById(application: BackendApplicationSpecV1, entityId: string): DataEntityIR {
  const entity = application.dataModel.entities.find((entry) => entry.id === entityId)
  if (!entity) throw new BackendDraftOperationError('Select an existing entity.')
  return entity
}

function entityById(application: BackendApplicationSpecV1, entityId: string): DataEntityIR {
  const entity = modelEntityById(application, entityId)
  if (entity.management !== 'managed') {
    throw new BackendDraftOperationError(
      'Relations can only create constraints on managed entities.'
    )
  }
  return entity
}

function fieldById(entity: DataEntityIR, fieldId: string): DataFieldIR {
  const field = entity.fields.find((entry) => entry.id === fieldId)
  if (!field) throw new BackendDraftOperationError('Select an existing entity field.')
  return field
}

function sameFieldType(left: DataFieldIR, right: DataFieldIR): boolean {
  return left.type === right.type && (left.type !== 'enum' || left.enumId === right.enumId)
}

function fieldSetEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((fieldId) => right.includes(fieldId))
}

function fieldSetIsUnique(entity: DataEntityIR, fields: readonly string[]): boolean {
  return (
    Boolean(entity.primaryKey && fieldSetEqual(entity.primaryKey.fields, fields)) ||
    Boolean(entity.uniques?.some((entry) => fieldSetEqual(entry.fields, fields)))
  )
}

function foreignKeyById(entity: DataEntityIR, foreignKeyId?: string): DataForeignKeyIR | undefined {
  return foreignKeyId
    ? entity.foreignKeys?.find((foreignKey) => foreignKey.id === foreignKeyId)
    : undefined
}

function relationForeignKey(
  application: BackendApplicationSpecV1,
  relation: DataRelationIR
): DataForeignKeyIR | undefined {
  const source = application.dataModel.entities.find(
    (entity) => entity.id === relation.sourceEntityId
  )
  return source ? foreignKeyById(source, relation.sourceForeignKeyId) : undefined
}

function directRelationExists(
  application: BackendApplicationSpecV1,
  input: AddDirectBackendRelationInput
): boolean {
  return application.dataModel.relations.some((relation) => {
    if (
      relation.kind === 'many-to-many' ||
      relation.sourceEntityId !== input.sourceEntityId ||
      relation.targetEntityId !== input.targetEntityId
    ) {
      return false
    }
    const foreignKey = relationForeignKey(application, relation)
    return (
      foreignKey?.fields.length === 1 &&
      foreignKey.fields[0] === input.sourceFieldId &&
      foreignKey.targetFields.length === 1 &&
      foreignKey.targetFields[0] === input.targetFieldId
    )
  })
}

export function addBackendEntity(
  application: BackendApplicationSpecV1,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataEntityIR {
  requireCapacity(
    application.dataModel.entities.length,
    BACKEND_LIMITS.maxEntities,
    'Backend entities'
  )
  const name = uniqueBackendIdentifier(
    'table',
    application.dataModel.entities.map((entry) => entry.name)
  )
  const idField: DataFieldIR = {
    id: createId('field'),
    name: 'id',
    type: 'uuid',
    nullable: false,
    default: { kind: 'generated', generator: 'uuid' }
  }
  const entity: DataEntityIR = {
    id: createId('entity'),
    name,
    management: 'managed',
    fields: [idField],
    primaryKey: { fields: [idField.id] }
  }
  application.dataModel.entities.push(entity)
  return entity
}

export function addBackendField(
  entity: DataEntityIR,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataFieldIR {
  if (entity.management !== 'managed') {
    throw new BackendDraftOperationError('External entities cannot declare managed fields.')
  }
  requireCapacity(entity.fields.length, BACKEND_LIMITS.maxFieldsPerEntity, 'Entity fields')
  const field: DataFieldIR = {
    id: createId('field'),
    name: uniqueBackendIdentifier(
      'field',
      entity.fields.map((entry) => entry.name)
    ),
    type: 'string',
    nullable: true
  }
  entity.fields.push(field)
  return field
}

function fieldParticipatesInForeignKey(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): boolean {
  return application.dataModel.entities.some((entity) =>
    entity.foreignKeys?.some(
      (foreignKey) =>
        (entity.id === entityId && foreignKey.fields.includes(fieldId)) ||
        (foreignKey.targetEntityId === entityId && foreignKey.targetFields.includes(fieldId))
    )
  )
}

export function setBackendFieldType(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  field: DataFieldIR,
  type: DataFieldIR['type']
): void {
  fieldById(entity, field.id)
  if (field.type === type) return
  if (fieldParticipatesInForeignKey(application, entity.id, field.id)) {
    throw new BackendDraftOperationError(
      'Remove relation constraints before changing this field type.'
    )
  }
  if (type === 'enum' && !application.dataModel.enums[0]) {
    throw new BackendDraftOperationError('Add an enum before changing this field to enum.')
  }
  field.type = type
  if (type === 'enum') field.enumId = application.dataModel.enums[0].id
  else delete field.enumId
  delete field.default
}

export function setBackendFieldNullable(
  entity: DataEntityIR,
  field: DataFieldIR,
  nullable: boolean
): void {
  fieldById(entity, field.id)
  if (nullable && entity.primaryKey?.fields.includes(field.id)) {
    throw new BackendDraftOperationError('Primary-key fields cannot be nullable.')
  }
  if (
    !nullable &&
    entity.foreignKeys?.some(
      (foreignKey) => foreignKey.onDelete === 'set-null' && foreignKey.fields.includes(field.id)
    )
  ) {
    throw new BackendDraftOperationError(
      'Change the relation delete action before making this field required.'
    )
  }
  if (!nullable && field.default?.kind === 'literal' && field.default.value === null) {
    throw new BackendDraftOperationError(
      'Remove the null default before making this field required.'
    )
  }
  field.nullable = nullable
}

export function setBackendFieldPrimary(
  entity: DataEntityIR,
  fieldId: string,
  enabled: boolean
): void {
  const field = fieldById(entity, fieldId)
  const fields = entity.primaryKey?.fields ?? []
  const next = enabled
    ? [...new Set([...fields, fieldId])]
    : fields.filter((candidate) => candidate !== fieldId)
  if (enabled) {
    field.nullable = false
    if (field.default?.kind === 'literal' && field.default.value === null) delete field.default
  }
  if (next.length > 0) entity.primaryKey = { fields: next }
  else delete entity.primaryKey
}

export function setBackendFieldUnique(
  entity: DataEntityIR,
  fieldId: string,
  enabled: boolean,
  createId: BackendDraftIdFactory = createBackendDraftId
): void {
  fieldById(entity, fieldId)
  const exists =
    entity.uniques?.some((entry) => entry.fields.length === 1 && entry.fields[0] === fieldId) ??
    false
  if (enabled && exists) return
  const retained = (entity.uniques ?? []).filter(
    (entry) => !(entry.fields.length === 1 && entry.fields[0] === fieldId)
  )
  if (enabled) {
    requireConstraintCapacity(entity, 'unique constraint')
    retained.push({ id: createId('unique'), fields: [fieldId] })
  }
  if (retained.length > 0) entity.uniques = retained
  else delete entity.uniques
}

export function addBackendEnum(
  application: BackendApplicationSpecV1,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataEnumIR {
  requireCapacity(application.dataModel.enums.length, BACKEND_LIMITS.maxEnums, 'Backend enums')
  const dataEnum: DataEnumIR = {
    id: createId('enum'),
    name: uniqueBackendIdentifier(
      'enum',
      application.dataModel.enums.map((entry) => entry.name)
    ),
    values: ['value']
  }
  application.dataModel.enums.push(dataEnum)
  return dataEnum
}

export function addBackendEnumValue(dataEnum: DataEnumIR): string {
  requireCapacity(dataEnum.values.length, BACKEND_LIMITS.maxEnumValues, 'Enum values')
  const value = uniqueBackendIdentifier('value', dataEnum.values)
  dataEnum.values.push(value)
  return value
}

export function removeBackendEnum(application: BackendApplicationSpecV1, enumId: string): boolean {
  const index = application.dataModel.enums.findIndex((dataEnum) => dataEnum.id === enumId)
  if (index === -1) return false
  if (
    application.dataModel.entities.some((entity) =>
      entity.fields.some((field) => field.type === 'enum' && field.enumId === enumId)
    )
  ) {
    throw new BackendDraftOperationError('Remove enum field references before removing this enum.')
  }
  application.dataModel.enums.splice(index, 1)
  return true
}

export function removeBackendEnumValue(
  application: BackendApplicationSpecV1,
  dataEnum: DataEnumIR,
  index: number
): boolean {
  const value = dataEnum.values.at(index)
  if (value === undefined) return false
  if (dataEnum.values.length === 1) {
    throw new BackendDraftOperationError('An enum must keep at least one value.')
  }
  if (
    application.dataModel.entities.some((entity) =>
      entity.fields.some(
        (field) =>
          field.type === 'enum' &&
          field.enumId === dataEnum.id &&
          field.default?.kind === 'literal' &&
          field.default.value === value
      )
    )
  ) {
    throw new BackendDraftOperationError(
      'Change field defaults that use this value before removing it.'
    )
  }
  dataEnum.values.splice(index, 1)
  return true
}

export function addBackendRole(
  application: BackendApplicationSpecV1,
  createId: BackendDraftIdFactory = createBackendDraftId
): AuthRoleIR {
  requireCapacity(application.auth.roles.length, MAX_AUTH_ROLES, 'Backend roles')
  const role: AuthRoleIR = {
    id: createId('role'),
    name: uniqueBackendIdentifier(
      'role',
      application.auth.roles.map((entry) => entry.name)
    )
  }
  application.auth.roles.push(role)
  return role
}

export interface AddDirectBackendRelationInput {
  readonly kind: 'one-to-one' | 'one-to-many'
  readonly sourceEntityId: string
  readonly sourceFieldId: string
  readonly targetEntityId: string
  readonly targetFieldId: string
}

export function addDirectBackendRelation(
  application: BackendApplicationSpecV1,
  input: AddDirectBackendRelationInput,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataRelationIR {
  requireCapacity(
    application.dataModel.relations.length,
    BACKEND_LIMITS.maxRelations,
    'Backend relations'
  )
  if (input.sourceEntityId === input.targetEntityId) {
    throw new BackendDraftOperationError('Choose two different relation endpoints.')
  }
  const source = entityById(application, input.sourceEntityId)
  const target = entityById(application, input.targetEntityId)
  const sourceField = fieldById(source, input.sourceFieldId)
  const targetField = fieldById(target, input.targetFieldId)
  if (!sameFieldType(sourceField, targetField)) {
    throw new BackendDraftOperationError('Relation fields must use the same scalar or enum type.')
  }
  if (!fieldSetIsUnique(target, [targetField.id])) {
    throw new BackendDraftOperationError('The target field must be a primary or unique key.')
  }
  if (directRelationExists(application, input)) {
    throw new BackendDraftOperationError('This relation already exists.')
  }
  requireConstraintCapacity(source, 'foreign key')
  if (input.kind === 'one-to-one' && !fieldSetIsUnique(source, [sourceField.id])) {
    requireConstraintCapacity(source, 'unique constraint')
  }

  const foreignKeyId = createId('foreign-key')
  source.foreignKeys = [
    ...(source.foreignKeys ?? []),
    {
      id: foreignKeyId,
      fields: [sourceField.id],
      targetEntityId: target.id,
      targetFields: [targetField.id],
      onDelete: 'restrict'
    }
  ]
  if (input.kind === 'one-to-one' && !fieldSetIsUnique(source, [sourceField.id])) {
    source.uniques = [
      ...(source.uniques ?? []),
      { id: createId('unique'), fields: [sourceField.id] }
    ]
  }
  const relation: DataRelationIR = {
    id: createId('relation'),
    kind: input.kind,
    sourceEntityId: source.id,
    targetEntityId: target.id,
    sourceForeignKeyId: foreignKeyId
  }
  application.dataModel.relations.push(relation)
  return relation
}

function singlePrimaryField(entity: DataEntityIR): DataFieldIR {
  const fields = entity.primaryKey?.fields ?? []
  if (fields.length !== 1) {
    throw new BackendDraftOperationError(
      'Automatic many-to-many setup requires a single-field primary key on each endpoint.'
    )
  }
  return fieldById(entity, fields[0])
}

function copiedForeignKeyField(
  source: DataEntityIR,
  target: DataFieldIR,
  usedNames: string[],
  createId: BackendDraftIdFactory
): DataFieldIR {
  const field: DataFieldIR = {
    id: createId('field'),
    name: uniqueBackendIdentifier(`${source.name}_id`, usedNames, 'entity_id'),
    type: target.type,
    ...(target.enumId ? { enumId: target.enumId } : {}),
    nullable: false
  }
  usedNames.push(field.name)
  return field
}

export interface AddManyToManyBackendRelationInput {
  readonly sourceEntityId: string
  readonly targetEntityId: string
}

export function addManyToManyBackendRelation(
  application: BackendApplicationSpecV1,
  input: AddManyToManyBackendRelationInput,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataRelationIR {
  requireCapacity(
    application.dataModel.relations.length,
    BACKEND_LIMITS.maxRelations,
    'Backend relations'
  )
  requireCapacity(
    application.dataModel.entities.length,
    BACKEND_LIMITS.maxEntities,
    'Backend entities'
  )
  if (input.sourceEntityId === input.targetEntityId) {
    throw new BackendDraftOperationError('Choose two different relation endpoints.')
  }
  const source = entityById(application, input.sourceEntityId)
  const target = entityById(application, input.targetEntityId)
  if (
    application.dataModel.relations.some(
      (relation) =>
        relation.kind === 'many-to-many' &&
        ((relation.sourceEntityId === source.id && relation.targetEntityId === target.id) ||
          (relation.sourceEntityId === target.id && relation.targetEntityId === source.id))
    )
  ) {
    throw new BackendDraftOperationError('This many-to-many relation already exists.')
  }
  const sourcePrimaryField = singlePrimaryField(source)
  const targetPrimaryField = singlePrimaryField(target)
  const usedFieldNames: string[] = []
  const sourceField = copiedForeignKeyField(source, sourcePrimaryField, usedFieldNames, createId)
  const targetField = copiedForeignKeyField(target, targetPrimaryField, usedFieldNames, createId)
  const sourceForeignKeyId = createId('foreign-key')
  const targetForeignKeyId = createId('foreign-key')
  const junction: DataEntityIR = {
    id: createId('entity'),
    name: uniqueBackendIdentifier(
      `${source.name}_${target.name}`,
      application.dataModel.entities.map((entry) => entry.name),
      'junction'
    ),
    management: 'managed',
    fields: [sourceField, targetField],
    primaryKey: { fields: [sourceField.id, targetField.id] },
    foreignKeys: [
      {
        id: sourceForeignKeyId,
        fields: [sourceField.id],
        targetEntityId: source.id,
        targetFields: [sourcePrimaryField.id],
        onDelete: 'cascade'
      },
      {
        id: targetForeignKeyId,
        fields: [targetField.id],
        targetEntityId: target.id,
        targetFields: [targetPrimaryField.id],
        onDelete: 'cascade'
      }
    ]
  }
  application.dataModel.entities.push(junction)
  const relation: DataRelationIR = {
    id: createId('relation'),
    kind: 'many-to-many',
    sourceEntityId: source.id,
    targetEntityId: target.id,
    junctionEntityId: junction.id
  }
  application.dataModel.relations.push(relation)
  return relation
}

const RELATION_DELETE_ACTIONS = new Set<DataForeignKeyIR['onDelete']>([
  'restrict',
  'cascade',
  'set-null',
  'no-action'
])

export function setBackendRelationOnDelete(
  application: BackendApplicationSpecV1,
  relationId: string,
  onDelete: DataForeignKeyIR['onDelete']
): void {
  if (!RELATION_DELETE_ACTIONS.has(onDelete)) {
    throw new BackendDraftOperationError('Select a supported relation delete action.')
  }
  const relation = application.dataModel.relations.find((entry) => entry.id === relationId)
  const foreignKey = relation ? relationForeignKey(application, relation) : undefined
  if (!relation || relation.kind === 'many-to-many' || !foreignKey) {
    throw new BackendDraftOperationError('The relation foreign key is unavailable.')
  }
  if (onDelete === 'set-null') {
    const source = entityById(application, relation.sourceEntityId)
    if (foreignKey.fields.some((fieldId) => !fieldById(source, fieldId).nullable)) {
      throw new BackendDraftOperationError('SET NULL requires nullable source fields.')
    }
  }
  foreignKey.onDelete = onDelete
}

function workflowReferencesEntity(
  steps: readonly BackendWorkflowStepIR[],
  entityId: string
): boolean {
  return steps.some((step) => {
    if ((step.kind === 'data.read' || step.kind === 'data.mutate') && step.entityId === entityId) {
      return true
    }
    return (
      step.kind === 'branch' &&
      (workflowReferencesEntity(step.consequent, entityId) ||
        workflowReferencesEntity(step.alternate, entityId))
    )
  })
}

function workflowReferencesField(
  steps: readonly BackendWorkflowStepIR[],
  entityId: string,
  fieldId: string
): boolean {
  return steps.some((step) => {
    if (step.kind === 'data.read' && step.entityId === entityId) {
      return (
        (step.fields?.includes(fieldId) ?? false) ||
        (step.filters?.some((filter) => filter.field === fieldId) ?? false)
      )
    }
    if (step.kind === 'data.mutate' && step.entityId === entityId) {
      return (
        (step.values?.some((entry) => entry.field === fieldId) ?? false) ||
        (step.filters?.some((filter) => filter.field === fieldId) ?? false)
      )
    }
    return (
      step.kind === 'branch' &&
      (workflowReferencesField(step.consequent, entityId, fieldId) ||
        workflowReferencesField(step.alternate, entityId, fieldId))
    )
  })
}

function workflowCalls(steps: readonly BackendWorkflowStepIR[], workflowId: string): boolean {
  return steps.some(
    (step) =>
      (step.kind === 'call' && step.workflowId === workflowId) ||
      (step.kind === 'branch' &&
        (workflowCalls(step.consequent, workflowId) || workflowCalls(step.alternate, workflowId)))
  )
}

function entityHasReferences(
  application: BackendApplicationSpecV1,
  entityId: string,
  excludedRelationId?: string
): boolean {
  if (
    application.dataModel.relations.some(
      (relation) =>
        relation.id !== excludedRelationId &&
        (relation.sourceEntityId === entityId ||
          relation.targetEntityId === entityId ||
          relation.junctionEntityId === entityId)
    )
  ) {
    return true
  }
  if (
    application.dataModel.entities.some((entity) =>
      entity.foreignKeys?.some((foreignKey) => foreignKey.targetEntityId === entityId)
    )
  ) {
    return true
  }
  if (
    application.auth.ownership.some((entry) => entry.entityId === entityId) ||
    application.auth.tenants.some(
      (entry) => entry.entityId === entityId || entry.membershipEntityId === entityId
    ) ||
    application.auth.rowAccess.some((entry) => entry.entityId === entityId)
  ) {
    return true
  }
  return application.workflows.workflows.some((workflow) =>
    workflowReferencesEntity(workflow.steps, entityId)
  )
}

function removeForeignKey(entity: DataEntityIR | undefined, foreignKeyId?: string): void {
  if (!entity || !foreignKeyId) return
  const remaining = entity.foreignKeys?.filter((foreignKey) => foreignKey.id !== foreignKeyId)
  if (remaining?.length) entity.foreignKeys = remaining
  else delete entity.foreignKeys
}

export function removeBackendRelation(
  application: BackendApplicationSpecV1,
  relationId: string
): boolean {
  const relationIndex = application.dataModel.relations.findIndex(
    (relation) => relation.id === relationId
  )
  if (relationIndex === -1) return false
  const relation = application.dataModel.relations[relationIndex]
  const ownedForeignKeyIds = new Set(
    [relation.sourceForeignKeyId, relation.targetForeignKeyId].filter(
      (foreignKeyId): foreignKeyId is string => typeof foreignKeyId === 'string'
    )
  )
  if (
    application.dataModel.relations.some(
      (candidate) =>
        candidate.id !== relation.id &&
        [candidate.sourceForeignKeyId, candidate.targetForeignKeyId].some(
          (foreignKeyId) => foreignKeyId && ownedForeignKeyIds.has(foreignKeyId)
        )
    )
  ) {
    throw new BackendDraftOperationError('Another relation still uses this foreign key.')
  }
  const junctionId = relation.kind === 'many-to-many' ? relation.junctionEntityId : undefined
  if (junctionId && entityHasReferences(application, junctionId, relation.id)) {
    throw new BackendDraftOperationError(
      'The generated junction entity is still referenced. Remove those declarations first.'
    )
  }

  const source = application.dataModel.entities.find(
    (entity) => entity.id === relation.sourceEntityId
  )
  const target = application.dataModel.entities.find(
    (entity) => entity.id === relation.targetEntityId
  )
  removeForeignKey(source, relation.sourceForeignKeyId)
  removeForeignKey(target, relation.targetForeignKeyId)
  application.dataModel.relations.splice(relationIndex, 1)
  if (junctionId) {
    const junctionIndex = application.dataModel.entities.findIndex(
      (entity) => entity.id === junctionId
    )
    if (junctionIndex !== -1) application.dataModel.entities.splice(junctionIndex, 1)
  }
  return true
}

export type ReplaceBackendRelationInput =
  | AddDirectBackendRelationInput
  | Readonly<{
      kind: 'many-to-many'
      sourceEntityId: string
      targetEntityId: string
    }>

export function replaceBackendRelation(
  application: BackendApplicationSpecV1,
  relationId: string,
  input: ReplaceBackendRelationInput,
  createId: BackendDraftIdFactory = createBackendDraftId
): DataRelationIR {
  const candidate = structuredClone(application)
  if (!removeBackendRelation(candidate, relationId)) {
    throw new BackendDraftOperationError('Select an existing relation.')
  }
  const replacement =
    input.kind === 'many-to-many'
      ? addManyToManyBackendRelation(candidate, input, createId)
      : addDirectBackendRelation(candidate, input, createId)
  replacement.id = relationId
  application.dataModel = candidate.dataModel
  return replacement
}

export function removeBackendEntity(
  application: BackendApplicationSpecV1,
  entityId: string
): boolean {
  const index = application.dataModel.entities.findIndex((entity) => entity.id === entityId)
  if (index === -1) return false
  if (entityHasReferences(application, entityId)) {
    throw new BackendDraftOperationError(
      'Remove relations, policies, and workflow references before removing this entity.'
    )
  }
  application.dataModel.entities.splice(index, 1)
  return true
}

export function removeBackendField(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): boolean {
  const entity = entityById(application, entityId)
  const index = entity.fields.findIndex((field) => field.id === fieldId)
  if (index === -1) return false
  const constrained =
    (entity.primaryKey?.fields.includes(fieldId) ?? false) ||
    (entity.foreignKeys?.some((foreignKey) => foreignKey.fields.includes(fieldId)) ?? false) ||
    (entity.uniques?.some((unique) => unique.fields.includes(fieldId)) ?? false) ||
    (entity.indexes?.some((entry) => entry.fields.includes(fieldId)) ?? false) ||
    application.dataModel.entities.some((candidate) =>
      candidate.foreignKeys?.some(
        (foreignKey) =>
          foreignKey.targetEntityId === entityId && foreignKey.targetFields.includes(fieldId)
      )
    )
  const secured =
    application.auth.ownership.some(
      (entry) => entry.entityId === entityId && entry.identityFieldId === fieldId
    ) ||
    application.auth.tenants.some(
      (entry) =>
        (entry.entityId === entityId && entry.tenantFieldId === fieldId) ||
        (entry.membershipEntityId === entityId &&
          (entry.membershipIdentityFieldId === fieldId ||
            entry.membershipTenantFieldId === fieldId))
    )
  const usedByWorkflow = application.workflows.workflows.some((workflow) =>
    workflowReferencesField(workflow.steps, entityId, fieldId)
  )
  if (constrained || secured || usedByWorkflow) {
    throw new BackendDraftOperationError(
      'Remove constraints, policies, and workflow references before removing this field.'
    )
  }
  entity.fields.splice(index, 1)
  return true
}

export function addBackendOwnership(
  application: BackendApplicationSpecV1,
  entityId: string,
  identityFieldId: string,
  createId: BackendDraftIdFactory = createBackendDraftId
): AuthOwnershipIR {
  requireCapacity(
    application.auth.ownership.length,
    BACKEND_LIMITS.maxPolicies,
    'Ownership policies'
  )
  fieldById(entityById(application, entityId), identityFieldId)
  if (
    application.auth.ownership.some(
      (entry) => entry.entityId === entityId && entry.identityFieldId === identityFieldId
    )
  ) {
    throw new BackendDraftOperationError('This ownership rule already exists.')
  }
  const ownership = { id: createId('ownership'), entityId, identityFieldId }
  application.auth.ownership.push(ownership)
  return ownership
}

export function addBackendTenant(
  application: BackendApplicationSpecV1,
  entityId: string,
  tenantFieldId: string,
  createId: BackendDraftIdFactory = createBackendDraftId
): AuthTenantIR {
  requireCapacity(application.auth.tenants.length, BACKEND_LIMITS.maxPolicies, 'Tenant policies')
  fieldById(entityById(application, entityId), tenantFieldId)
  if (
    application.auth.tenants.some(
      (entry) => entry.entityId === entityId && entry.tenantFieldId === tenantFieldId
    )
  ) {
    throw new BackendDraftOperationError('This tenant rule already exists.')
  }
  const tenant = { id: createId('tenant'), entityId, tenantFieldId }
  application.auth.tenants.push(tenant)
  return tenant
}

export function setBackendTenantEntity(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  entityId: string
): void {
  if (
    tenant.entityId !== entityId &&
    application.auth.rowAccess.some(
      (intent) =>
        intent.principal.kind === 'tenant-member' && intent.principal.tenantId === tenant.id
    )
  ) {
    throw new BackendDraftOperationError(
      'Change row-access principals before moving this tenant rule.'
    )
  }
  const entity = entityById(application, entityId)
  const tenantField =
    entity.fields.find((field) => field.id === tenant.tenantFieldId) ?? entity.fields.at(0)
  if (!tenantField) {
    throw new BackendDraftOperationError('Tenant rules require an entity with at least one field.')
  }
  if (
    application.auth.tenants.some(
      (entry) =>
        entry.id !== tenant.id &&
        entry.entityId === entity.id &&
        entry.tenantFieldId === tenantField.id
    )
  ) {
    throw new BackendDraftOperationError('This tenant rule already exists.')
  }
  tenant.entityId = entity.id
  tenant.tenantFieldId = tenantField.id
}

export function setBackendOwnershipEntity(
  application: BackendApplicationSpecV1,
  ownership: AuthOwnershipIR,
  entityId: string
): void {
  if (
    ownership.entityId !== entityId &&
    application.auth.rowAccess.some(
      (intent) => intent.principal.kind === 'owner' && intent.principal.ownershipId === ownership.id
    )
  ) {
    throw new BackendDraftOperationError(
      'Change row-access principals before moving this ownership rule.'
    )
  }
  const entity = entityById(application, entityId)
  const identityField =
    entity.fields.find((field) => field.id === ownership.identityFieldId) ?? entity.fields.at(0)
  if (!identityField) {
    throw new BackendDraftOperationError('Ownership rules require an entity with a field.')
  }
  if (
    application.auth.ownership.some(
      (entry) =>
        entry.id !== ownership.id &&
        entry.entityId === entity.id &&
        entry.identityFieldId === identityField.id
    )
  ) {
    throw new BackendDraftOperationError('This ownership rule already exists.')
  }
  ownership.entityId = entity.id
  ownership.identityFieldId = identityField.id
}

export function setBackendOwnershipField(
  application: BackendApplicationSpecV1,
  ownership: AuthOwnershipIR,
  fieldId: string
): void {
  const entity = entityById(application, ownership.entityId)
  fieldById(entity, fieldId)
  if (
    application.auth.ownership.some(
      (entry) =>
        entry.id !== ownership.id &&
        entry.entityId === ownership.entityId &&
        entry.identityFieldId === fieldId
    )
  ) {
    throw new BackendDraftOperationError('This ownership rule already exists.')
  }
  ownership.identityFieldId = fieldId
}

export function setBackendTenantField(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  tenantFieldId: string
): void {
  const entity = entityById(application, tenant.entityId)
  fieldById(entity, tenantFieldId)
  if (
    application.auth.tenants.some(
      (entry) =>
        entry.id !== tenant.id &&
        entry.entityId === tenant.entityId &&
        entry.tenantFieldId === tenantFieldId
    )
  ) {
    throw new BackendDraftOperationError('This tenant rule already exists.')
  }
  tenant.tenantFieldId = tenantFieldId
}

export function setBackendTenantMembershipEntity(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  membershipEntityId?: string
): void {
  if (!membershipEntityId) {
    delete tenant.membershipEntityId
    delete tenant.membershipIdentityFieldId
    delete tenant.membershipTenantFieldId
    return
  }
  const entity = entityById(application, membershipEntityId)
  const identityField =
    entity.fields.find((field) => field.id === tenant.membershipIdentityFieldId) ??
    entity.fields.at(0)
  const tenantField =
    entity.fields.find((field) => field.id === tenant.membershipTenantFieldId) ??
    entity.fields.find((field) => field.id !== identityField?.id) ??
    identityField
  if (!identityField || !tenantField) {
    throw new BackendDraftOperationError(
      'Tenant membership requires an entity with at least one field.'
    )
  }
  tenant.membershipEntityId = entity.id
  tenant.membershipIdentityFieldId = identityField.id
  tenant.membershipTenantFieldId = tenantField.id
}

export function setBackendTenantMembershipField(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  fieldKind: 'identity' | 'tenant',
  fieldId: string
): void {
  if (!tenant.membershipEntityId) {
    throw new BackendDraftOperationError('Select a tenant membership entity first.')
  }
  const entity = entityById(application, tenant.membershipEntityId)
  fieldById(entity, fieldId)
  if (fieldKind === 'identity') tenant.membershipIdentityFieldId = fieldId
  else tenant.membershipTenantFieldId = fieldId
}

export function addBackendRowAccess(
  application: BackendApplicationSpecV1,
  entityId: string,
  createId: BackendDraftIdFactory = createBackendDraftId
): AuthRowAccessIntentIR {
  requireCapacity(
    application.auth.rowAccess.length,
    BACKEND_LIMITS.maxPolicies,
    'Row access policies'
  )
  entityById(application, entityId)
  const intent: AuthRowAccessIntentIR = {
    id: createId('row-access'),
    entityId,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'authenticated' }
  }
  application.auth.rowAccess.push(intent)
  return intent
}

export function setBackendRowAccessEntity(
  application: BackendApplicationSpecV1,
  intent: AuthRowAccessIntentIR,
  entityId: string
): void {
  entityById(application, entityId)
  intent.entityId = entityId
  if (intent.principal.kind === 'owner') {
    const ownership = application.auth.ownership.find((entry) => entry.entityId === entityId)
    intent.principal = ownership
      ? { kind: 'owner', ownershipId: ownership.id }
      : { kind: 'authenticated' }
  } else if (intent.principal.kind === 'tenant-member') {
    const tenant = application.auth.tenants.find((entry) => entry.entityId === entityId)
    intent.principal = tenant
      ? { kind: 'tenant-member', tenantId: tenant.id }
      : { kind: 'authenticated' }
  }
}

export function removeBackendRole(application: BackendApplicationSpecV1, roleId: string): boolean {
  const index = application.auth.roles.findIndex((role) => role.id === roleId)
  if (index === -1) return false
  if (
    application.auth.rowAccess.some(
      (intent) => intent.principal.kind === 'role' && intent.principal.roleId === roleId
    )
  ) {
    throw new BackendDraftOperationError('Remove row-access references before removing this role.')
  }
  application.auth.roles.splice(index, 1)
  return true
}

export function removeBackendOwnership(
  application: BackendApplicationSpecV1,
  ownershipId: string
): boolean {
  const index = application.auth.ownership.findIndex((entry) => entry.id === ownershipId)
  if (index === -1) return false
  if (
    application.auth.rowAccess.some(
      (intent) => intent.principal.kind === 'owner' && intent.principal.ownershipId === ownershipId
    )
  ) {
    throw new BackendDraftOperationError(
      'Remove row-access references before removing this ownership rule.'
    )
  }
  application.auth.ownership.splice(index, 1)
  return true
}

export function removeBackendTenant(
  application: BackendApplicationSpecV1,
  tenantId: string
): boolean {
  const index = application.auth.tenants.findIndex((entry) => entry.id === tenantId)
  if (index === -1) return false
  const usedByRows = application.auth.rowAccess.some(
    (intent) => intent.principal.kind === 'tenant-member' && intent.principal.tenantId === tenantId
  )
  const usedByStorage = application.storage?.buckets.some((bucket) =>
    bucket.pathRules.some(
      (rule) => rule.principal.kind === 'tenant-member' && rule.principal.tenantId === tenantId
    )
  )
  if (usedByRows || usedByStorage) {
    throw new BackendDraftOperationError(
      'Remove row-access and Storage references before removing this tenant rule.'
    )
  }
  application.auth.tenants.splice(index, 1)
  return true
}

function storageBucketById(
  application: BackendApplicationSpecV1,
  bucketId: string
): BackendStorageBucketIR {
  const bucket = application.storage?.buckets.find((entry) => entry.id === bucketId)
  if (!bucket) throw new BackendDraftOperationError('Select an existing Storage bucket.')
  return bucket
}

function tenantHasCompleteMembership(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR
): boolean {
  if (
    !tenant.membershipEntityId ||
    !tenant.membershipIdentityFieldId ||
    !tenant.membershipTenantFieldId
  ) {
    return false
  }
  const membership = application.dataModel.entities.find(
    (entity) => entity.id === tenant.membershipEntityId
  )
  return Boolean(
    membership?.fields.some((field) => field.id === tenant.membershipIdentityFieldId) &&
    membership.fields.some((field) => field.id === tenant.membershipTenantFieldId)
  )
}

export function backendStorageTenantOptions(
  application: BackendApplicationSpecV1
): readonly AuthTenantIR[] {
  return application.auth.tenants.filter((tenant) =>
    tenantHasCompleteMembership(application, tenant)
  )
}

function nextStoragePrefix(bucket: BackendStorageBucketIR): string {
  return uniqueBackendIdentifier(
    'objects',
    bucket.pathRules.flatMap((rule) => (rule.prefix[0] ? [rule.prefix[0]] : []))
  ).toLowerCase()
}

export function addBackendStorageBucket(
  application: BackendApplicationSpecV1,
  createId: BackendDraftIdFactory = createBackendDraftId
): BackendStorageBucketIR {
  const storage = (application.storage ??= { version: 1, buckets: [] })
  requireCapacity(storage.buckets.length, BACKEND_LIMITS.maxStorageBuckets, 'Storage buckets')
  const name = uniqueBackendIdentifier(
    'bucket',
    storage.buckets.map((entry) => entry.name)
  ).toLowerCase()
  const bucket: BackendStorageBucketIR = {
    id: createId('storage-bucket'),
    name,
    access: 'private',
    maxObjectBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['application/octet-stream'],
    pathRules: [
      {
        id: createId('storage-path-rule'),
        prefix: ['objects'],
        principal: { kind: 'owner' },
        operations: ['read', 'create', 'update', 'delete', 'upsert']
      }
    ]
  }
  storage.buckets.push(bucket)
  return bucket
}

export interface AddBackendStoragePathRuleInput {
  readonly bucketId: string
  readonly principal?: BackendStoragePrincipalIntent
}

export function addBackendStoragePathRule(
  application: BackendApplicationSpecV1,
  input: AddBackendStoragePathRuleInput,
  createId: BackendDraftIdFactory = createBackendDraftId
): BackendStoragePathRuleIR {
  const bucket = storageBucketById(application, input.bucketId)
  requireCapacity(bucket.pathRules.length, BACKEND_LIMITS.maxStoragePathRules, 'Storage path rules')
  const principal = input.principal ?? { kind: 'owner' }
  if (principal.kind === 'tenant-member') {
    const tenant = backendStorageTenantOptions(application).find(
      (entry) => entry.id === principal.tenantId
    )
    if (!tenant) {
      throw new BackendDraftOperationError(
        'Select an existing tenant rule with a complete membership mapping.'
      )
    }
  }
  const rule: BackendStoragePathRuleIR = {
    id: createId('storage-path-rule'),
    prefix: [nextStoragePrefix(bucket)],
    principal: { ...principal },
    operations: ['read', 'create', 'update', 'delete', 'upsert']
  }
  bucket.pathRules.push(rule)
  return rule
}

export function setBackendStoragePathRulePrincipal(
  application: BackendApplicationSpecV1,
  rule: BackendStoragePathRuleIR,
  kind: BackendStoragePrincipalIntent['kind'],
  tenantId?: string
): void {
  if (kind === 'owner') {
    rule.principal = { kind }
    return
  }
  const tenant = backendStorageTenantOptions(application).find((entry) => entry.id === tenantId)
  if (!tenant) {
    throw new BackendDraftOperationError(
      'Select an existing tenant rule with a complete membership mapping.'
    )
  }
  rule.principal = { kind, tenantId: tenant.id }
}

export function addBackendWorkflow(
  application: BackendApplicationSpecV1,
  createId: BackendDraftIdFactory = createBackendDraftId
): BackendWorkflowDefinitionIR {
  requireCapacity(
    application.workflows.workflows.length,
    BACKEND_LIMITS.maxWorkflows,
    'Backend workflows'
  )
  requireCapacity(
    countWorkflowSteps(application.workflows.workflows),
    BACKEND_LIMITS.maxWorkflowSteps,
    'Workflow steps'
  )
  const workflow: BackendWorkflowDefinitionIR = {
    id: createId('workflow'),
    name: `Workflow ${application.workflows.workflows.length + 1}`,
    trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
    parameters: [],
    steps: [{ id: createId('step'), kind: 'respond', status: 200 }]
  }
  application.workflows.workflows.push(workflow)
  return workflow
}

export type BackendWorkflowStepKind = BackendWorkflowStepIR['kind']

// A top-level step's deepest editable value is nine JSON levels below the application.
// Each branch adds an array and a step object; reserve room for those value bindings.
export const BACKEND_WORKFLOW_EDITOR_MAX_NESTING = Math.floor((BACKEND_LIMITS.maxDepth - 9) / 2)

function stepListDepth(
  current: readonly BackendWorkflowStepIR[],
  target: readonly BackendWorkflowStepIR[],
  depth = 0
): number | undefined {
  if (current === target) return depth
  if (depth >= BACKEND_WORKFLOW_EDITOR_MAX_NESTING) return undefined
  for (const step of current) {
    if (step.kind !== 'branch') continue
    const found =
      stepListDepth(step.consequent, target, depth + 1) ??
      stepListDepth(step.alternate, target, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export function canAddBackendWorkflowStep(
  application: BackendApplicationSpecV1,
  workflow: BackendWorkflowDefinitionIR,
  kind: BackendWorkflowStepKind,
  destination: readonly BackendWorkflowStepIR[] = workflow.steps
): boolean {
  if (!application.workflows.workflows.includes(workflow)) return false
  const depth = stepListDepth(workflow.steps, destination)
  if (
    depth === undefined ||
    depth + (kind === 'branch' ? 1 : 0) > BACKEND_WORKFLOW_EDITOR_MAX_NESTING
  ) {
    return false
  }
  return (
    countWorkflowSteps(application.workflows.workflows) + (kind === 'branch' ? 3 : 1) <=
    BACKEND_LIMITS.maxWorkflowSteps
  )
}

function countSteps(steps: readonly BackendWorkflowStepIR[]): number {
  return steps.reduce(
    (count, step) =>
      count +
      1 +
      (step.kind === 'branch' ? countSteps(step.consequent) + countSteps(step.alternate) : 0),
    0
  )
}

function countWorkflowSteps(workflows: readonly BackendWorkflowDefinitionIR[]): number {
  return workflows.reduce((count, workflow) => count + countSteps(workflow.steps), 0)
}

function firstWorkflowEntity(
  application: BackendApplicationSpecV1,
  requireManagedFields: boolean
): DataEntityIR {
  const entity = application.dataModel.entities.find(
    (entry) => !requireManagedFields || (entry.management === 'managed' && entry.fields.length > 0)
  )
  if (!entity) {
    throw new BackendDraftOperationError(
      requireManagedFields
        ? 'Add a managed entity field before creating a data mutation.'
        : 'Add an entity before creating a data step.'
    )
  }
  return entity
}

function defaultMutationFields(entity: DataEntityIR): DataFieldIR[] {
  const required = entity.fields.filter((field) => !field.nullable && field.default === undefined)
  return required.length > 0 ? required : entity.fields.slice(0, 1)
}

export function setBackendWorkflowStepEntity(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.read' | 'data.mutate' }>,
  entityId: string
): void {
  if (step.kind === 'data.read') {
    const entity = modelEntityById(application, entityId)
    step.entityId = entity.id
    delete step.fields
    delete step.filters
    return
  }
  const entity = entityById(application, entityId)
  step.entityId = entity.id
  step.values = defaultMutationFields(entity).map((field) => ({
    field: field.id,
    value: { kind: 'expression', expression: '$currentUser.id' }
  }))
  delete step.filters
}

export function setBackendWorkflowMutationValueField(
  application: BackendApplicationSpecV1,
  step: Extract<BackendWorkflowStepIR, { kind: 'data.mutate' }>,
  index: number,
  fieldId: string
): void {
  const entity = entityById(application, step.entityId)
  fieldById(entity, fieldId)
  const entry = step.values?.[index]
  if (!entry) throw new BackendDraftOperationError('Select an existing mutation value.')
  if (
    step.values?.some(
      (candidate, candidateIndex) => candidateIndex !== index && candidate.field === fieldId
    )
  ) {
    throw new BackendDraftOperationError('Each mutation field can be assigned only once.')
  }
  entry.field = fieldId
}

export function removeBackendWorkflow(
  application: BackendApplicationSpecV1,
  workflowId: string
): boolean {
  const index = application.workflows.workflows.findIndex((workflow) => workflow.id === workflowId)
  if (index === -1) return false
  if (
    application.workflows.workflows.some(
      (workflow) => workflow.id !== workflowId && workflowCalls(workflow.steps, workflowId)
    )
  ) {
    throw new BackendDraftOperationError(
      'Remove calls to this workflow before removing the workflow.'
    )
  }
  application.workflows.workflows.splice(index, 1)
  return true
}

/**
 * Adds a bounded step to one list owned by this workflow. Nested lists use the same
 * application-wide count and leave room for the deepest editable value in the Core depth limit.
 */
export function addBackendWorkflowStep(
  application: BackendApplicationSpecV1,
  workflow: BackendWorkflowDefinitionIR,
  kind: BackendWorkflowStepKind,
  createId: BackendDraftIdFactory = createBackendDraftId,
  destination: BackendWorkflowStepIR[] = workflow.steps
): BackendWorkflowStepIR {
  if (!canAddBackendWorkflowStep(application, workflow, kind, destination)) {
    throw new BackendDraftOperationError(
      'Workflow step destination or nesting/count limit is invalid.'
    )
  }
  requireCapacity(
    countWorkflowSteps(application.workflows.workflows),
    BACKEND_LIMITS.maxWorkflowSteps,
    'Workflow steps',
    kind === 'branch' ? 3 : 1
  )
  let step: BackendWorkflowStepIR
  if (kind === 'respond') {
    step = { id: createId('step'), kind, status: 200 }
  } else if (kind === 'data.read') {
    const entity = firstWorkflowEntity(application, false)
    step = {
      id: createId('step'),
      kind,
      entityId: entity.id,
      resultName: uniqueBackendIdentifier(
        'rows',
        collectWorkflowSteps(workflow.steps).flatMap((entry) =>
          'resultName' in entry && entry.resultName ? [entry.resultName] : []
        )
      )
    }
  } else if (kind === 'data.mutate') {
    const entity = firstWorkflowEntity(application, true)
    step = {
      id: createId('step'),
      kind,
      entityId: entity.id,
      operation: 'insert',
      values: defaultMutationFields(entity).map((field) => ({
        field: field.id,
        value: { kind: 'expression', expression: '$currentUser.id' }
      }))
    }
  } else if (kind === 'http.request') {
    step = {
      id: createId('step'),
      kind,
      method: 'GET',
      url: { kind: 'expression', expression: '"https://example.invalid"' }
    }
  } else if (kind === 'branch') {
    step = {
      id: createId('step'),
      kind,
      condition: 'true',
      consequent: [{ id: createId('step'), kind: 'respond', status: 200 }],
      alternate: [{ id: createId('step'), kind: 'respond', status: 200 }]
    }
  } else {
    const target = application.workflows.workflows.find((entry) => entry.id !== workflow.id)
    if (!target) {
      throw new BackendDraftOperationError('Add another workflow before creating a workflow call.')
    }
    step = { id: createId('step'), kind, workflowId: target.id }
  }
  // Keep the default final response last so newly authored steps are reachable.
  const finalResponse =
    destination.at(-1)?.kind === 'respond' ? destination.length - 1 : destination.length
  destination.splice(finalResponse, 0, step)
  return step
}

function collectWorkflowSteps(steps: readonly BackendWorkflowStepIR[]): BackendWorkflowStepIR[] {
  return steps.flatMap((step) =>
    step.kind === 'branch'
      ? [step, ...collectWorkflowSteps(step.consequent), ...collectWorkflowSteps(step.alternate)]
      : [step]
  )
}
