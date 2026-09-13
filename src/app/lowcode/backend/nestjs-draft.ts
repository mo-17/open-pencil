import { BACKEND_LIMITS } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIResourceIRV1,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { createEmptyBackendApplication } from './document'
import { BackendDraftOperationError, removeBackendEntity } from './draft'
import { pruneHTTPAPIQuery } from './http-api-query'

export function isNestJSProvider(providerId: string | undefined): boolean {
  return providerId === 'nestjs'
}

function uniqueName(preferred: string, existing: readonly string[]): string {
  for (let index = 1; index <= 128; index++) {
    const candidate = index === 1 ? preferred : `${preferred}_${index}`
    if (!existing.includes(candidate)) return candidate
  }
  throw new BackendDraftOperationError('No available identifier remains.')
}

export function addNestJSField(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  preferred = 'field'
): DataFieldIR {
  if (entity.fields.length >= BACKEND_LIMITS.maxFieldsPerEntity)
    throw new BackendDraftOperationError('Field limit reached.')
  const id = uniqueName(
    preferred,
    entity.fields.map((entry) => entry.id)
  )
  const field: DataFieldIR = {
    id,
    name: id,
    type: 'string',
    nullable: false,
    default: { kind: 'literal', value: '' }
  }
  entity.fields.push(field)
  for (const resource of application.httpApi?.resources ?? []) {
    if (resource.entityId !== entity.id) continue
    resource.readFields.push(id)
    resource.createFields?.push(id)
    resource.updateFields?.push(id)
  }
  return field
}

export function addNestJSEntity(
  application: BackendApplicationSpecV1,
  preferred = 'notes'
): DataEntityIR {
  if (!application.httpApi || application.auth.identities.length !== 1) {
    throw new BackendDraftOperationError('Initialize the NestJS model before adding an entity.')
  }
  if (application.dataModel.entities.length >= 32)
    throw new BackendDraftOperationError('NestJS supports up to 32 entities.')
  const name = uniqueName(
    preferred,
    application.dataModel.entities.map((entry) => entry.name)
  )
  const entity: DataEntityIR = {
    id: crypto.randomUUID(),
    name,
    management: 'managed',
    fields: [
      {
        id: 'id',
        name: 'id',
        type: 'uuid',
        nullable: false,
        default: { kind: 'generated', generator: 'uuid' }
      },
      { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false }
    ],
    primaryKey: { fields: ['id'] }
  }
  application.dataModel.entities.push(entity)
  const ownershipId = crypto.randomUUID()
  application.auth.ownership.push({
    id: ownershipId,
    entityId: entity.id,
    identityFieldId: 'owner_id'
  })
  application.auth.rowAccess.push({
    id: crypto.randomUUID(),
    entityId: entity.id,
    effect: 'allow',
    operations: ['select', 'insert', 'update', 'delete'],
    principal: { kind: 'owner', ownershipId }
  })
  const resourceId = uniqueName(
    name,
    application.httpApi.resources.map((entry) => entry.id)
  )
  const resource: BackendHttpAPIResourceIRV1 = {
    id: resourceId,
    path: `/${resourceId}`,
    entityId: entity.id,
    operations: ['list', 'read', 'create', 'update', 'delete'],
    readFields: ['id'],
    createFields: [],
    updateFields: [],
    maxPageSize: 50
  }
  application.httpApi.resources.push(resource)
  addNestJSField(application, entity, 'title')
  addNestJSField(application, entity, 'content')
  return entity
}

export function createNestJSNotesApplication(applicationId: string): BackendApplicationSpecV1 {
  const application = createEmptyBackendApplication(applicationId)
  application.auth.identities.push({ id: 'user', kind: 'user' })
  application.secrets = ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_JWKS_URL', 'DATABASE_URL'].map(
    (name) => ({
      kind: 'environment',
      name,
      exposure: 'server',
      required: true
    })
  )
  application.httpApi = {
    version: 1,
    authentication: {
      kind: 'jwt',
      identityId: 'user',
      issuerEnvironment: 'JWT_ISSUER',
      audienceEnvironment: 'JWT_AUDIENCE',
      jwksUrlEnvironment: 'JWT_JWKS_URL',
      algorithms: ['RS256']
    },
    resources: []
  }
  enableNestJSBrowserClient(application)
  addNestJSEntity(application)
  return application
}

export function removeNestJSFieldReferences(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): void {
  for (const resource of application.httpApi?.resources ?? []) {
    if (resource.entityId !== entityId) continue
    resource.readFields = resource.readFields.filter((id) => id !== fieldId)
    if (resource.createFields)
      resource.createFields = resource.createFields.filter((id) => id !== fieldId)
    if (resource.updateFields)
      resource.updateFields = resource.updateFields.filter((id) => id !== fieldId)
    pruneHTTPAPIQuery(resource)
  }
}

export function isNestJSServerField(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  fieldId: string
): boolean {
  return Boolean(
    entity.primaryKey?.fields.includes(fieldId) ||
    application.auth.ownership.some(
      (rule) => rule.entityId === entity.id && rule.identityFieldId === fieldId
    )
  )
}

export function enableNestJSBrowserClient(application: BackendApplicationSpecV1): void {
  if (application.httpApi?.browserClient) return
  if (!application.httpApi) return
  application.httpApi.browserClient = {
    version: 1,
    apiBasePath: '/api',
    authentication: {
      kind: 'oidc-pkce',
      issuer: '',
      clientId: '',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    }
  }
}

export function removeNestJSEntity(application: BackendApplicationSpecV1, entityId: string): void {
  const candidate = structuredClone(application)
  candidate.auth.rowAccess = candidate.auth.rowAccess.filter((rule) => rule.entityId !== entityId)
  candidate.auth.ownership = candidate.auth.ownership.filter((rule) => rule.entityId !== entityId)
  if (candidate.httpApi)
    candidate.httpApi.resources = candidate.httpApi.resources.filter(
      (resource) => resource.entityId !== entityId
    )
  removeBackendEntity(candidate, entityId)
  application.dataModel = candidate.dataModel
  application.auth = candidate.auth
  application.httpApi = candidate.httpApi
}
