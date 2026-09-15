import type {
  AuthPrincipalIntent,
  AuthRowAccessIntentIR,
  BackendApplicationSpecV1,
  BackendHttpAPIResourceIRV1,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

export function businessGrant(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  id: string,
  principal: AuthPrincipalIntent,
  operations: AuthRowAccessIntentIR['operations'] = ['select']
): string {
  application.auth.rowAccess.push({
    id,
    entityId: entity.id,
    effect: 'allow',
    operations,
    principal
  })
  return id
}

export function businessOwnerGrant(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  operations: AuthRowAccessIntentIR['operations'] = ['select']
): string {
  const owner = application.auth.ownership.find((entry) => entry.entityId === entity.id)
  if (!owner) throw new Error('Business entity ownership is missing.')
  return businessGrant(
    application,
    entity,
    owner.id,
    { kind: 'owner', ownershipId: owner.id },
    operations
  )
}

/** Reviewed anonymous read access; callers explicitly supply every row condition. */
export function businessPublicGrant(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  id: string,
  conditions: NonNullable<AuthRowAccessIntentIR['conditions']>
): string {
  application.auth.rowAccess.push({
    id,
    entityId: entity.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: structuredClone(conditions)
  })
  return id
}

export function businessReadResource(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  id: string,
  fields: readonly string[],
  readPolicyIds: readonly string[]
): BackendHttpAPIResourceIRV1 {
  if (!application.httpApi) throw new Error('Business HTTP API is missing.')
  const resource: BackendHttpAPIResourceIRV1 = {
    id,
    path: `/${id}`,
    entityId: entity.id,
    operations: ['list', 'read'],
    readFields: [...fields],
    readPolicyIds: [...readPolicyIds],
    maxPageSize: 50,
    query: { filterFields: [], searchFields: [], sortFields: ['created_at'] }
  }
  application.httpApi.resources.push(resource)
  return resource
}
