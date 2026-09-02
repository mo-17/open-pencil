import type {
  DataEntityIR,
  DataFieldIR,
  DataForeignKeyIR,
  DataModelIR,
  DataRelationIR
} from './types'
import type { BackendValidationContext } from './validation-helpers'

function assertFieldReferences(
  fields: ReadonlyMap<string, DataFieldIR>,
  fieldReferences: readonly string[],
  path: string,
  context: BackendValidationContext
): void {
  for (const fieldId of fieldReferences) {
    if (!fields.has(fieldId)) {
      context.diagnostics.push({
        code: 'backend-field-reference-missing',
        severity: 'error',
        path,
        message: 'Referenced field does not exist on the entity.'
      })
    }
  }
}

function validateEnumReferences(
  entity: DataEntityIR,
  enums: ReadonlyMap<string, ReadonlySet<string>>,
  context: BackendValidationContext
): void {
  for (const field of entity.fields) {
    if (field.type !== 'enum' || !field.enumId) continue
    const values = enums.get(field.enumId)
    if (!values) {
      context.diagnostics.push({
        code: 'backend-enum-reference-missing',
        severity: 'error',
        path: `$.dataModel.entities.${entity.id}.fields.${field.id}.enumId`,
        message: 'Referenced enum does not exist.'
      })
      continue
    }
    if (
      field.default?.kind === 'literal' &&
      typeof field.default.value === 'string' &&
      !values.has(field.default.value)
    ) {
      context.diagnostics.push({
        code: 'backend-enum-default-invalid',
        severity: 'error',
        path: `$.dataModel.entities.${entity.id}.fields.${field.id}.default`,
        message: 'Enum field default must be one of the referenced enum values.'
      })
    }
  }
}

function validatePrimaryKeyReferences(
  entity: DataEntityIR,
  fields: ReadonlyMap<string, DataFieldIR>,
  context: BackendValidationContext
): void {
  if (!entity.primaryKey) return
  const path = `$.dataModel.entities.${entity.id}.primaryKey.fields`
  assertFieldReferences(fields, entity.primaryKey.fields, path, context)
  for (const fieldId of entity.primaryKey.fields) {
    if (!fields.get(fieldId)?.nullable) continue
    context.diagnostics.push({
      code: 'backend-primary-key-nullable',
      severity: 'error',
      path,
      message: 'Primary-key fields cannot be nullable.'
    })
  }
}

function validateForeignKeyFieldPair(
  entity: DataEntityIR,
  foreignKey: DataForeignKeyIR,
  fields: ReadonlyMap<string, DataFieldIR>,
  targetFields: ReadonlyMap<string, DataFieldIR>,
  index: number,
  context: BackendValidationContext
): void {
  const path = `$.dataModel.entities.${entity.id}.foreignKeys.${foreignKey.id}`
  const local = fields.get(foreignKey.fields[index])
  const remote = targetFields.get(foreignKey.targetFields[index])
  if (!remote) {
    context.diagnostics.push({
      code: 'backend-foreign-field-missing',
      severity: 'error',
      path: `${path}.targetFields`,
      message: 'Foreign-key target field does not exist.'
    })
  } else if (local && (local.type !== remote.type || local.enumId !== remote.enumId)) {
    context.diagnostics.push({
      code: 'backend-foreign-field-type',
      severity: 'error',
      path,
      message: 'Foreign-key field types must match.'
    })
  }
  if (foreignKey.onDelete === 'set-null' && local && !local.nullable) {
    context.diagnostics.push({
      code: 'backend-foreign-set-null',
      severity: 'error',
      path: `${path}.onDelete`,
      message: 'set-null requires nullable local fields.'
    })
  }
}

function validateForeignKeyReferences(
  entity: DataEntityIR,
  foreignKey: DataForeignKeyIR,
  fields: ReadonlyMap<string, DataFieldIR>,
  entities: ReadonlyMap<string, DataEntityIR>,
  context: BackendValidationContext
): void {
  const path = `$.dataModel.entities.${entity.id}.foreignKeys.${foreignKey.id}`
  assertFieldReferences(fields, foreignKey.fields, `${path}.fields`, context)
  const target = entities.get(foreignKey.targetEntityId)
  if (!target) {
    context.diagnostics.push({
      code: 'backend-foreign-entity-missing',
      severity: 'error',
      path: `${path}.targetEntityId`,
      message: 'Foreign-key target entity does not exist.'
    })
    return
  }
  const targetFields = new Map(target.fields.map((entry) => [entry.id, entry]))
  const targetIsUnique =
    Boolean(target.primaryKey && sameFieldSet(target.primaryKey.fields, foreignKey.targetFields)) ||
    Boolean(target.uniques?.some((entry) => sameFieldSet(entry.fields, foreignKey.targetFields)))
  if (!targetIsUnique) {
    context.diagnostics.push({
      code: 'backend-foreign-target-not-unique',
      severity: 'error',
      path: `${path}.targetFields`,
      message: 'Foreign-key target fields must exactly match a primary or unique field set.'
    })
  }
  for (let index = 0; index < foreignKey.fields.length; index++) {
    validateForeignKeyFieldPair(entity, foreignKey, fields, targetFields, index, context)
  }
}

function validateEntityReferenceShape(
  entity: DataEntityIR,
  entities: ReadonlyMap<string, DataEntityIR>,
  enums: ReadonlyMap<string, ReadonlySet<string>>,
  context: BackendValidationContext
): void {
  const fields = new Map(entity.fields.map((entry) => [entry.id, entry]))
  validateEnumReferences(entity, enums, context)
  validatePrimaryKeyReferences(entity, fields, context)
  for (const index of entity.indexes ?? []) {
    assertFieldReferences(
      fields,
      index.fields,
      `$.dataModel.entities.${entity.id}.indexes.${index.id}`,
      context
    )
  }
  for (const unique of entity.uniques ?? []) {
    assertFieldReferences(
      fields,
      unique.fields,
      `$.dataModel.entities.${entity.id}.uniques.${unique.id}`,
      context
    )
  }
  for (const foreignKey of entity.foreignKeys ?? []) {
    validateForeignKeyReferences(entity, foreignKey, fields, entities, context)
  }
}

function relationForeignKey(
  owner: DataEntityIR,
  opposite: DataEntityIR,
  foreignKeyId: string,
  path: string,
  context: BackendValidationContext
): DataForeignKeyIR | undefined {
  const foreignKey = owner.foreignKeys?.find((entry) => entry.id === foreignKeyId)
  if (!foreignKey) {
    context.diagnostics.push({
      code: 'backend-relation-foreign-key-missing',
      severity: 'error',
      path,
      message: 'Relation foreign key does not exist on the declared endpoint.'
    })
    return undefined
  }
  if (foreignKey.targetEntityId !== opposite.id) {
    context.diagnostics.push({
      code: 'backend-relation-foreign-key-target-mismatch',
      severity: 'error',
      path,
      message: 'Relation foreign key must target the opposite endpoint.'
    })
    return undefined
  }
  return foreignKey
}

function sameFieldSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((fieldId) => right.includes(fieldId))
}

function isUniqueForeignKey(owner: DataEntityIR, foreignKey: DataForeignKeyIR): boolean {
  if (owner.primaryKey && sameFieldSet(owner.primaryKey.fields, foreignKey.fields)) return true
  return Boolean(owner.uniques?.some((entry) => sameFieldSet(entry.fields, foreignKey.fields)))
}

function validateDirectRelation(
  relation: DataRelationIR,
  source: DataEntityIR,
  target: DataEntityIR,
  path: string,
  context: BackendValidationContext
): void {
  if (!relation.sourceForeignKeyId && !relation.targetForeignKeyId) {
    context.diagnostics.push({
      code: 'backend-relation-foreign-key-required',
      severity: 'error',
      path,
      message: 'One-to-one and one-to-many relations require an explicit endpoint foreign key.'
    })
    return
  }
  const sourceForeignKey = relation.sourceForeignKeyId
    ? relationForeignKey(
        source,
        target,
        relation.sourceForeignKeyId,
        `${path}.sourceForeignKeyId`,
        context
      )
    : undefined
  const targetForeignKey = relation.targetForeignKeyId
    ? relationForeignKey(
        target,
        source,
        relation.targetForeignKeyId,
        `${path}.targetForeignKeyId`,
        context
      )
    : undefined
  if (relation.kind !== 'one-to-one') return
  for (const [owner, foreignKey, foreignKeyPath] of [
    [source, sourceForeignKey, `${path}.sourceForeignKeyId`],
    [target, targetForeignKey, `${path}.targetForeignKeyId`]
  ] as const) {
    if (foreignKey && !isUniqueForeignKey(owner, foreignKey)) {
      context.diagnostics.push({
        code: 'backend-relation-one-to-one-not-unique',
        severity: 'error',
        path: foreignKeyPath,
        message: 'One-to-one relation foreign-key fields must be primary or explicitly unique.'
      })
    }
  }
}

function validateJunctionRelation(
  relation: DataRelationIR,
  source: DataEntityIR,
  target: DataEntityIR,
  entities: ReadonlyMap<string, DataEntityIR>,
  path: string,
  context: BackendValidationContext
): void {
  if (relation.sourceForeignKeyId || relation.targetForeignKeyId) {
    context.diagnostics.push({
      code: 'backend-relation-junction-endpoint-foreign-key-unexpected',
      severity: 'error',
      path,
      message: 'Many-to-many relations bind through junction foreign keys, not endpoint fields.'
    })
  }
  const junction = relation.junctionEntityId ? entities.get(relation.junctionEntityId) : undefined
  if (!junction) {
    context.diagnostics.push({
      code: 'backend-relation-junction-missing',
      severity: 'error',
      path: `${path}.junctionEntityId`,
      message: 'Relation junction entity does not exist.'
    })
    return
  }
  if (
    junction.management !== 'managed' ||
    junction.id === source.id ||
    junction.id === target.id ||
    source.id === target.id
  ) {
    context.diagnostics.push({
      code: 'backend-relation-junction-ambiguous',
      severity: 'error',
      path: `${path}.junctionEntityId`,
      message:
        'Many-to-many relations require a distinct managed junction and two distinct endpoints.'
    })
    return
  }
  for (const endpoint of [source, target]) {
    const matches = (junction.foreignKeys ?? []).filter(
      (foreignKey) => foreignKey.targetEntityId === endpoint.id
    )
    if (matches.length !== 1) {
      context.diagnostics.push({
        code: 'backend-relation-junction-foreign-key-cardinality',
        severity: 'error',
        path: `${path}.junctionEntityId`,
        message: 'Junction entity must have exactly one foreign key to each relation endpoint.'
      })
    }
  }
}

function validateRelationReferences(
  relation: DataRelationIR,
  entities: ReadonlyMap<string, DataEntityIR>,
  context: BackendValidationContext
): void {
  const path = `$.dataModel.relations.${relation.id}`
  const source = entities.get(relation.sourceEntityId)
  const target = entities.get(relation.targetEntityId)
  if (!source || !target) {
    context.diagnostics.push({
      code: 'backend-relation-entity-missing',
      severity: 'error',
      path,
      message: 'Relation entities must exist.'
    })
    return
  }
  if (relation.kind === 'many-to-many') {
    validateJunctionRelation(relation, source, target, entities, path, context)
    return
  }
  validateDirectRelation(relation, source, target, path, context)
}

export function validateEntityReferences(
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const entities = new Map(model.entities.map((entry) => [entry.id, entry]))
  const enums = new Map(model.enums.map((entry) => [entry.id, new Set(entry.values)]))
  for (const entity of model.entities) {
    validateEntityReferenceShape(entity, entities, enums, context)
  }
  for (const relation of model.relations) validateRelationReferences(relation, entities, context)
}

export function validateForeignKeyCycles(
  model: DataModelIR,
  context: BackendValidationContext
): void {
  const graph = new Map<string, string[]>()
  for (const entity of model.entities) {
    if (entity.management !== 'managed') continue
    graph.set(
      entity.id,
      (entity.foreignKeys ?? [])
        .map((entry) => entry.targetEntityId)
        .filter((targetId) =>
          model.entities.some(
            (candidate) => candidate.id === targetId && candidate.management === 'managed'
          )
        )
    )
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (entityId: string): boolean => {
    if (visiting.has(entityId)) return true
    if (visited.has(entityId)) return false
    visiting.add(entityId)
    for (const targetId of graph.get(entityId) ?? []) {
      if (walk(targetId)) return true
    }
    visiting.delete(entityId)
    visited.add(entityId)
    return false
  }
  for (const entityId of graph.keys()) {
    if (walk(entityId)) {
      context.diagnostics.push({
        code: 'backend-foreign-key-cycle',
        severity: 'error',
        path: '$.dataModel.entities',
        message: 'Cyclic managed foreign keys require an unsupported deferred-constraint plan.'
      })
      return
    }
  }
}
