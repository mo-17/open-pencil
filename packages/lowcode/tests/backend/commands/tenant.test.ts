import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilities,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import {
  commandApplication,
  insertStep,
  parameter,
  readStep,
  required,
  result,
  updateStep
} from './fixture'

function tenantCommands() {
  const app = commandApplication()
  for (const entity of app.dataModel.entities) {
    entity.fields.push({ id: 'store_id', name: 'store_id', type: 'uuid', nullable: false })
    app.auth.tenants.push({
      id: entity.id + '-store',
      entityId: entity.id,
      tenantFieldId: 'store_id',
      membershipEntityId: 'notes',
      membershipIdentityFieldId: 'owner_id',
      membershipTenantFieldId: 'id'
    })
  }
  app.auth.roles.push({ id: 'merchant', name: 'merchant' })
  app.auth.rowAccess.push({
    id: 'tenant-create',
    entityId: 'notes',
    effect: 'allow',
    operations: ['insert'],
    principal: { kind: 'tenant-member', tenantId: 'notes-store', roleId: 'merchant' }
  })
  app.httpApi.resources[0].createFields?.push('store_id')
  const command = required(app.commands).commands[0]
  command.access = {
    kind: 'tenant-member',
    tenantId: 'notes-store',
    parameter: 'storeId',
    roleId: 'merchant'
  }
  command.parameters.push({ name: 'storeId', type: 'uuid', required: true })
  readStep(command.steps[0]).scope = 'tenant'
  readStep(command.steps[0]).fields.push('store_id')
  insertStep(command.steps[4]).values.push({
    field: 'store_id',
    value: result('product', 'store_id')
  })
  app.capabilities = deriveBackendApplicationCapabilities(app).map((capability) => ({
    capability,
    required: true
  }))
  return { app, command }
}

describe('command tenant authority and immutable lineage', () => {
  test('preserves tenant-role AND grants and accepts only inherited or authorized inserted tenant identities', () => {
    const { app, command } = tenantCommands()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    const insert = insertStep(command.steps[4])
    required(insert.values.find((entry) => entry.field === 'store_id')).value = parameter('storeId')
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    command.access = { kind: 'authenticated' }
    readStep(command.steps[0]).scope = 'command'
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
    required(insert.values.find((entry) => entry.field === 'store_id')).value = result(
      'product',
      'store_id'
    )
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
  })

  test.each([
    'unknown-tenant',
    'missing-role',
    'bad-parameter',
    'unscoped-read',
    'tenant-rebind',
    'member-rebind',
    'foreign-locator',
    'missing-access'
  ])('rejects %s', (fault) => {
    const { app, command } = tenantCommands()
    if (fault === 'unknown-tenant')
      command.access = { kind: 'tenant-member', tenantId: 'unknown', parameter: 'storeId' }
    if (fault === 'missing-role')
      command.access = {
        kind: 'tenant-member',
        tenantId: 'notes-store',
        parameter: 'storeId',
        roleId: 'unknown'
      }
    if (fault === 'bad-parameter')
      command.access = { kind: 'tenant-member', tenantId: 'notes-store', parameter: 'quantity' }
    if (fault === 'unscoped-read') readStep(command.steps[0]).scope = 'command'
    if (fault === 'missing-access') command.access = { kind: 'authenticated' }
    if (fault === 'tenant-rebind')
      updateStep(command.steps[3]).values = [{ field: 'store_id', value: parameter('storeId') }]
    if (fault === 'member-rebind')
      updateStep(command.steps[3]).values = [{ field: 'id', value: parameter('storeId') }]
    if (fault === 'foreign-locator') app.auth.tenants[1].membershipIdentityFieldId = 'product_id'
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })

  test('HTTP tenant selectors require an explicit tenant insert grant and never allow rebinding', () => {
    const { app } = tenantCommands()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    app.httpApi.resources[0].updateFields?.push('store_id')
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
    app.httpApi.resources[0].updateFields = ['title']
    app.auth.rowAccess = app.auth.rowAccess.filter((policy) => policy.id !== 'tenant-create')
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })

  test('tenant principal role IDs must exist and are not normalized away', () => {
    const { app } = tenantCommands()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected tenant application')
    expect(
      parsed.value.auth.rowAccess.find((policy) => policy.id === 'tenant-create')?.principal
    ).toEqual({ kind: 'tenant-member', tenantId: 'notes-store', roleId: 'merchant' })
    app.auth.roles = []
    expect(parseBackendApplicationSpecV1(app).ok).toBe(false)
  })
})
