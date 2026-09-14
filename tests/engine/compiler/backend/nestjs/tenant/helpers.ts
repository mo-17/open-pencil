import { deriveBackendApplicationCapabilities } from '@open-pencil/lowcode/backend'

import { commandApplication } from '../commands/helpers'

export const STORE = '40000000-0000-4000-8000-000000000004'
export const OTHER_STORE = '50000000-0000-4000-8000-000000000005'

export function tenantApplication() {
  const app = commandApplication()
  const notes = app.dataModel.entities[0]
  const stores = structuredClone(notes)
  stores.id = 'stores'
  stores.name = 'stores'
  stores.fields = stores.fields.filter((field) => ['id', 'owner_id', 'title'].includes(field.id))
  stores.uniques = [{ id: 'one-store-per-owner', fields: ['owner_id'] }]
  app.dataModel.entities.push(stores)
  notes.fields.push({ id: 'store_id', name: 'store_id', type: 'uuid', nullable: false })
  notes.foreignKeys = [
    {
      id: 'store',
      fields: ['store_id'],
      targetEntityId: stores.id,
      targetFields: ['id'],
      onDelete: 'restrict'
    }
  ]
  app.auth.ownership.push({ id: 'store-owner', entityId: stores.id, identityFieldId: 'owner_id' })
  app.auth.roles = [{ id: 'merchant', name: 'merchant' }]
  app.auth.tenants = [
    {
      id: 'notes-store',
      entityId: notes.id,
      tenantFieldId: 'store_id',
      membershipEntityId: stores.id,
      membershipIdentityFieldId: 'owner_id',
      membershipTenantFieldId: 'id'
    }
  ]
  app.auth.rowAccess = [
    {
      id: 'own-notes',
      entityId: notes.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: app.auth.ownership[0].id }
    },
    {
      id: 'merchant-notes',
      entityId: notes.id,
      effect: 'allow',
      operations: ['select', 'insert', 'update', 'delete'],
      principal: { kind: 'tenant-member', tenantId: 'notes-store', roleId: 'merchant' }
    },
    {
      id: 'public-stores',
      entityId: stores.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    },
    {
      id: 'own-store',
      entityId: stores.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: 'store-owner' }
    },
    {
      id: 'create-store',
      entityId: stores.id,
      effect: 'allow',
      operations: ['insert'],
      principal: { kind: 'role', roleId: 'merchant' }
    }
  ]
  const api = app.httpApi
  if (!api || !app.commands) throw new Error('Missing tenant test API.')
  api.resources[0].readFields.push('store_id')
  api.resources[0].createFields?.push('store_id')
  api.resources.push({
    id: 'stores',
    path: '/stores',
    entityId: stores.id,
    operations: ['list', 'read', 'create'],
    readFields: ['id', 'title'],
    createFields: ['title'],
    maxPageSize: 25
  })
  const command = app.commands.commands[0]
  command.access = {
    kind: 'tenant-member',
    tenantId: 'notes-store',
    parameter: 'storeId',
    roleId: 'merchant'
  }
  command.parameters.push({ name: 'storeId', type: 'uuid', required: true })
  const read = command.steps[0]
  if (read.kind !== 'data.read') throw new Error('Missing command read.')
  read.scope = 'tenant'
  app.capabilities = deriveBackendApplicationCapabilities(app).map((capability) => ({
    capability,
    required: true
  }))
  return app
}
