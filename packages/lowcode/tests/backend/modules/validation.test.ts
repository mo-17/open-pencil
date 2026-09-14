import { describe, expect, test } from 'bun:test'

import {
  backendModuleReferencedEntities,
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type BackendModuleIRV1
} from '@open-pencil/lowcode/backend'

import { commandApplication, required } from '../commands/fixture'
import { commerceApplication } from '../commerce/fixture'

function modularApplication(): BackendApplicationSpecV1 & { modules: BackendModuleIRV1 } {
  const application = commandApplication()
  return {
    ...application,
    modules: {
      version: 1,
      modules: [
        {
          id: 'catalog',
          name: 'Catalog',
          entityIds: ['notes'],
          resourceIds: application.httpApi.resources.map((resource) => resource.id),
          commandIds: [],
          dependsOn: []
        },
        {
          id: 'sales',
          name: 'Sales',
          entityIds: ['orders'],
          resourceIds: [],
          commandIds: ['checkout', 'cancel'],
          dependsOn: ['catalog']
        }
      ]
    }
  }
}
function rejected(application: unknown, code: string) {
  const parsed = parseBackendApplicationSpecV1(application)
  expect(parsed.ok).toBe(false)
  expect(parsed.diagnostics.some((entry) => entry.code === code)).toBe(true)
}

describe('reviewed modular backend partitions', () => {
  test('normalizes a complete partition without changing underlying authority', () => {
    const application = modularApplication()
    const parsed = parseBackendApplicationSpecV1(application)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    expect(parsed.value.modules?.modules[1].commandIds).toEqual(['cancel', 'checkout'])
    const { modules: _modules, ...plain } = application
    const legacy = parseBackendApplicationSpecV1(plain)
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.diagnostics))
    const { modules: _normalized, ...withoutModules } = parsed.value
    expect(withoutModules).toEqual(legacy.value)
    expect(
      [...backendModuleReferencedEntities(application.modules.modules[1], application)].sort()
    ).toEqual(['notes', 'orders'])
  })
  test.each(['../escape', 'Sales', 'a/b', 'a.b', 'a'.repeat(49)])(
    'rejects unsafe module ID %s',
    (id) => {
      const application = modularApplication()
      application.modules.modules[0].id = id
      rejected(application, 'backend-module-invalid')
    }
  )
  test.each(['entityIds', 'resourceIds', 'commandIds'] as const)(
    'requires complete unique %s ownership',
    (key) => {
      const application = modularApplication()
      const owner = required(application.modules.modules.find((module) => module[key].length > 0))
      const value = required(owner[key].pop())
      rejected(
        application,
        key === 'entityIds' ? 'backend-module-invalid' : 'backend-module-partition-invalid'
      )
      owner[key].push(value)
      required(application.modules.modules.find((module) => module !== owner))[key].push(value)
      rejected(application, 'backend-module-partition-invalid')
    }
  )
  test('rejects wrong resource owner and undeclared command dependency', () => {
    const application = modularApplication()
    application.modules.modules[1].resourceIds =
      application.modules.modules[0].resourceIds.splice(0)
    rejected(application, 'backend-module-resource-owner')
    const missing = modularApplication()
    missing.modules.modules[1].dependsOn = []
    rejected(missing, 'backend-module-dependency-missing')
  })
  test('rejects dependency cycles, unknown and self references', () => {
    for (const id of ['sales', 'unknown', 'catalog']) {
      const application = modularApplication()
      application.modules.modules[0].dependsOn = [id]
      rejected(
        application,
        id === 'sales' ? 'backend-module-dependency-cycle' : 'backend-module-dependency-invalid'
      )
    }
  })
  test('requires explicit foreign-key and row-policy membership dependencies', () => {
    const application = modularApplication()
    application.dataModel.entities[1].foreignKeys = [
      {
        id: 'product',
        fields: ['product_id'],
        targetEntityId: 'notes',
        targetFields: ['id'],
        onDelete: 'restrict'
      }
    ]
    expect(
      backendModuleReferencedEntities(application.modules.modules[1], application).has('notes')
    ).toBe(true)
    application.auth.rowAccess.push({
      id: 'member',
      entityId: 'orders',
      effect: 'allow',
      operations: ['select'],
      principal: {
        kind: 'related-member',
        membershipEntityId: 'notes',
        identityFieldId: 'owner_id',
        membershipFieldId: 'id',
        entityFieldId: 'product_id'
      }
    })
    required(application.httpApi).resources.push({
      id: 'orders',
      entityId: 'orders',
      path: '/api/orders',
      operations: ['list'],
      readFields: ['id'],
      maxPageSize: 25
    })
    application.modules.modules[1].resourceIds.push('orders')
    delete application.commands
    application.modules.modules[1].commandIds = []
    application.dataModel.entities.push({
      id: 'anchor',
      name: 'anchor',
      management: 'managed',
      primaryKey: { fields: ['id'] },
      fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }]
    })
    application.modules.modules.push({
      id: 'anchor',
      name: 'Anchor',
      entityIds: ['anchor'],
      resourceIds: [],
      commandIds: [],
      dependsOn: []
    })
    // Both lookup fields share an anchor, but neither entity references the other.
    application.dataModel.entities[0].foreignKeys = [
      {
        id: 'anchor',
        fields: ['id'],
        targetEntityId: 'anchor',
        targetFields: ['id'],
        onDelete: 'restrict'
      }
    ]
    required(application.dataModel.entities[1].foreignKeys)[0].targetEntityId = 'anchor'
    application.modules.modules[0].dependsOn = ['anchor']
    application.modules.modules[1].dependsOn.push('anchor')
    const catalog = required(application.httpApi).resources[0]
    catalog.operations = ['list', 'read']
    delete catalog.createFields
    delete catalog.updateFields
    const parsed = parseBackendApplicationSpecV1(application)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    application.modules.modules[1].dependsOn = ['anchor']
    rejected(application, 'backend-module-dependency-missing')
    expect(
      backendModuleReferencedEntities(application.modules.modules[1], application).has('notes')
    ).toBe(true)
  })
  test('keeps the legacy 16-command limit, but permits 17 commands partitioned across two modules', () => {
    const application = modularApplication()
    const checkout = required(application.commands).commands[0]
    const catalogCommand = {
      ...structuredClone(checkout),
      id: 'catalog-read',
      path: '/commands/catalog-read',
      steps: [structuredClone(checkout.steps[0]), structuredClone(checkout.steps[3])],
      return: { resultName: 'inventory', fields: ['id', 'stock'] }
    }
    const sales = Array.from({ length: 16 }, (_, index) => ({
      ...structuredClone(checkout),
      id: 'checkout-' + index,
      path: '/commands/checkout-' + index
    }))
    application.commands = { version: 1, commands: [...sales, catalogCommand] }
    application.modules.modules[0].commandIds = [catalogCommand.id]
    application.modules.modules[1].commandIds = sales.map((command) => command.id)
    const parsed = parseBackendApplicationSpecV1(application)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    const { modules: _modules, ...legacy } = application
    expect(parseBackendApplicationSpecV1(legacy).ok).toBe(false)
    application.modules.modules[0].id = '../invalid'
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('refuses unowned workflow/storage features and authority-like module fields', () => {
    const workflow = modularApplication()
    workflow.workflows.workflows.push({
      id: 'hello',
      name: 'Hello',
      parameters: [],
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      steps: [{ id: 'done', kind: 'respond', status: 200 }]
    })
    rejected(workflow, 'backend-module-feature-unsupported')
    const storage = modularApplication()
    storage.storage = { version: 1, buckets: [] }
    rejected(storage, 'backend-module-feature-unsupported')
    const authority = modularApplication()
    Object.assign(authority.modules.modules[0], { roles: ['manager'] })
    expect(parseBackendApplicationSpecV1(authority).ok).toBe(false)
  })
  test('keeps commerce indivisible and refuses V2 lowering', () => {
    const application = commerceApplication()
    application.modules = {
      version: 1,
      modules: [
        {
          id: 'commerce',
          name: 'Commerce',
          entityIds: application.dataModel.entities.map((entity) => entity.id),
          resourceIds: required(application.httpApi).resources.map((resource) => resource.id),
          commandIds: required(application.commands).commands.map((command) => command.id),
          dependsOn: []
        }
      ]
    }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const split = required(application.modules.modules[0].entityIds.pop())
    application.modules.modules.push({
      id: 'split',
      name: 'Split',
      entityIds: [split],
      resourceIds: [],
      commandIds: [],
      dependsOn: ['commerce']
    })
    rejected(application, 'backend-module-commerce-split')
    const lowered = lowerBackendApplicationSpecV1ToV2(modularApplication())
    expect(lowered.ok).toBe(false)
    expect(
      lowered.diagnostics.some((entry) => entry.code === 'backend-modules-v2-unsupported')
    ).toBe(true)
  })
})
