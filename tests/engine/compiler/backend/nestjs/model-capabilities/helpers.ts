import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler/backend'
import {
  deriveBackendApplicationCapabilities,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { browserApplication } from '../browser-client/helpers'

/** Source-managed fixtures for private same-owner relations; no live service is required. */
export function relationalApplication() {
  const application = structuredClone(browserApplication())
  if (!application.httpApi) throw new Error('Expected HTTP API')
  const child = application.dataModel.entities[0]
  child.name = 'a_notes'
  const parent = structuredClone(child)
  parent.id = 'folders'
  parent.name = 'z_folders'
  parent.uniques = [{ id: 'owner-key', fields: ['owner_id', 'id'] }]
  application.dataModel.entities.push(parent)
  child.fields.push({ id: 'folder_id', name: 'folder_id', type: 'uuid', nullable: true })
  child.foreignKeys = [
    {
      id: 'folder-reference',
      fields: ['owner_id', 'folder_id'],
      targetEntityId: parent.id,
      targetFields: ['owner_id', 'id'],
      onDelete: 'restrict'
    }
  ]
  child.indexes = [{ id: 'folder-order', fields: ['owner_id', 'folder_id'], order: 'desc' }]
  const owner = { ...application.auth.ownership[0], id: 'folders-owner', entityId: parent.id }
  application.auth.ownership.push(owner)
  application.auth.rowAccess.push({
    ...structuredClone(application.auth.rowAccess[0]),
    id: 'folders-access',
    entityId: parent.id,
    principal: { kind: 'owner', ownershipId: owner.id }
  })
  application.httpApi.resources.push({
    ...structuredClone(application.httpApi.resources[0]),
    id: 'folders-api',
    path: '/folders',
    entityId: parent.id
  })
  application.dataModel.relations.push({
    id: 'notes-folders',
    kind: 'one-to-many',
    sourceEntityId: child.id,
    targetEntityId: parent.id,
    sourceForeignKeyId: 'folder-reference'
  })
  return application
}

export function normalizeModelApplication(application: BackendApplicationSpecV1) {
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({
      capability,
      required: true
    })
  )
  return parseBackendApplicationSpecV1(application)
}

export function modelPlan(application: BackendApplicationSpecV1) {
  return createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    application,
    selection: {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: 'sha256:' + 'A'.repeat(43),
      enabled: true
    },
    target: 'react',
    mode: 'production'
  })
}

export function modelFiles(application: BackendApplicationSpecV1) {
  const parsed = normalizeModelApplication(application)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
  const planned = modelPlan(parsed.value)
  if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
  const emitted = emitBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    plan: planned.plan,
    selection: {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: 'sha256:' + 'A'.repeat(43),
      enabled: true
    }
  })
  if (!emitted.ok) throw new Error(JSON.stringify(emitted.diagnostics))
  return emitted.emission.files
}

export function modelRequired<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('Missing model test fixture value')
  return value
}
