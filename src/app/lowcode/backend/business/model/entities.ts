import type {
  BackendApplicationSpecV1,
  BackendLiteral,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

export function businessField(
  id: string,
  type: DataFieldIR['type'],
  defaultValue?: BackendLiteral,
  nullable = false
): DataFieldIR {
  return {
    id,
    name: id,
    type,
    nullable,
    ...(defaultValue === undefined ? {} : { default: { kind: 'literal', value: defaultValue } })
  }
}

export function businessEnum(
  application: BackendApplicationSpecV1,
  id: string,
  values: readonly string[]
): void {
  application.dataModel.enums.push({ id, name: id.replaceAll('-', '_'), values: [...values] })
}

export function businessEnumField(id: string, enumId: string, initial: string): DataFieldIR {
  return { ...businessField(id, 'enum', initial), enumId }
}

export function addBusinessEntity(
  application: BackendApplicationSpecV1,
  name: string,
  fields: DataFieldIR[]
): DataEntityIR {
  const entity: DataEntityIR = {
    id: `business-${name.replaceAll('_', '-')}`,
    name,
    management: 'managed',
    fields: [
      { ...businessField('id', 'uuid'), default: { kind: 'generated', generator: 'uuid' } },
      businessField('owner_id', 'uuid'),
      ...fields,
      {
        ...businessField('created_at', 'datetime'),
        default: { kind: 'generated', generator: 'created-at' }
      }
    ],
    primaryKey: { fields: ['id'] },
    uniques: [{ id: 'owner-key', fields: ['id', 'owner_id'] }],
    indexes: [{ id: 'owner-created', fields: ['owner_id', 'created_at', 'id'], order: 'desc' }]
  }
  application.dataModel.entities.push(entity)
  application.auth.ownership.push({
    id: `own-${name.replaceAll('_', '-')}`,
    entityId: entity.id,
    identityFieldId: 'owner_id'
  })
  return entity
}

export function linkBusinessOwner(source: DataEntityIR, field: string, target: DataEntityIR): void {
  source.foreignKeys ??= []
  source.foreignKeys.push({
    id: `${field.replaceAll('_', '-')}-owner`,
    fields: [field, 'owner_id'],
    targetEntityId: target.id,
    targetFields: ['id', 'owner_id'],
    onDelete: 'restrict'
  })
}
