import { describe, expect, test } from 'bun:test'

import { planNestJSLocalPreviewMigration } from '@open-pencil/compiler/backend'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createInventoryApplication } from '@/app/lowcode/backend/business/model/inventory/application'
import { INVENTORY_ROLES } from '@/app/lowcode/backend/business/model/inventory/fields'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'inventory-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const inventory = () => createInventoryApplication('inventory-test', authentication)
function command(app: BackendApplicationSpecV1, id: string) {
  const entry = app.commands?.commands.find((item) => item.id === id)
  if (!entry) throw new Error('Missing command ' + id)
  return entry
}
const writes = (app: BackendApplicationSpecV1, id: string) =>
  command(app, id).steps.filter((step) => step.kind === 'data.mutate')

const stockCommands = [
  'receive-inventory-purchase',
  'return-inventory-purchase',
  'issue-inventory-stock',
  'return-inventory-dispatch',
  'adjust-inventory-stock'
]

describe('procurement and inventory model', () => {
  test('uses bounded ordinary transactions without a new closed domain or direct inventory write API', () => {
    const app = inventory()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(8)
    expect(app.commands?.commands).toHaveLength(15)
    expect(app.httpApi?.resources).toHaveLength(9)
    expect(app.auth.roles.map((role) => role.id)).toEqual([...INVENTORY_ROLES])
    for (const entry of app.commands?.commands ?? []) {
      expect(entry.steps.length).toBeGreaterThan(0)
      expect(entry.steps.length).toBeLessThanOrEqual(32)
      expect(entry.commerceOperation).toBeUndefined()
      expect(entry.foodOrderingOperation).toBeUndefined()
      expect(entry.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
      expect(entry.parameters.map((parameter) => parameter.name)).not.toContain('ownerId')
    }
    expect(
      command(app, 'register-business-user').parameters.map((parameter) => parameter.name)
    ).toEqual(['title'])
    expect(
      app.httpApi?.resources.every((resource) =>
        resource.operations.every((operation) => ['list', 'read'].includes(operation))
      )
    ).toBe(true)
  })

  test('confines all inventory reads to organization roles without an owner or anonymous bypass', () => {
    const app = inventory()
    for (const resource of app.httpApi?.resources.filter((entry) =>
      entry.id.startsWith('inventory-')
    ) ?? []) {
      const policies = app.auth.rowAccess.filter((policy) =>
        resource.readPolicyIds?.includes(policy.id)
      )
      expect(policies.map((policy) => policy.principal)).toEqual(
        INVENTORY_ROLES.map((roleId) => ({ kind: 'role', roleId }))
      )
      expect(resource.readFields).not.toContain('owner_id')
    }
    for (const id of stockCommands) {
      expect(command(app, id).access).toMatchObject({
        kind: 'row-policy',
        entityId: 'business-inventory-balances',
        parameter: 'balanceId'
      })
      const reads = command(app, id).steps.filter((step) => step.kind === 'data.read')
      expect(reads[0]?.resultName).toBe('balance')
      expect(reads.every((step) => step.lock === 'update')).toBe(true)
    }
    expect(command(app, 'adjust-inventory-stock').access).toMatchObject({
      roleId: 'inventory-manager'
    })
    expect(command(app, 'create-inventory-purchase').access).toMatchObject({
      roleId: 'inventory-manager'
    })
    expect(command(app, 'receive-inventory-purchase').access).not.toHaveProperty('roleId')
  })

  test('keeps one balance per SKU and warehouse and gives all documents the balance ownership boundary', () => {
    const app = inventory()
    const balances = app.dataModel.entities.find((entry) => entry.name === 'inventory_balances')
    expect(balances?.uniques).toContainEqual({
      id: 'sku-warehouse',
      fields: ['sku_id', 'warehouse_id']
    })
    expect(
      command(app, 'create-inventory-balance').parameters.map((parameter) => parameter.name)
    ).toEqual(['skuId', 'warehouseId'])
    for (const name of ['inventory_purchases', 'inventory_dispatches', 'inventory_movements']) {
      const entity = app.dataModel.entities.find((entry) => entry.name === name)
      expect(entity?.foreignKeys).toContainEqual(
        expect.objectContaining({
          fields: ['balance_id', 'owner_id'],
          targetEntityId: 'business-inventory-balances',
          targetFields: ['id', 'owner_id'],
          onDelete: 'restrict'
        })
      )
      for (const operation of app.commands?.commands ?? []) {
        for (const step of operation.steps) {
          if (
            step.kind !== 'data.mutate' ||
            step.operation !== 'insert' ||
            step.entityId !== entity?.id
          )
            continue
          expect(step.values.find((value) => value.field === 'owner_id')?.value).toEqual({
            kind: 'result',
            name: 'balance',
            field: 'owner_id'
          })
        }
      }
    }
  })

  test('writes bounded balances and append-only before/after audit in the same command', () => {
    const app = inventory()
    for (const id of stockCommands) {
      const entry = command(app, id)
      expect(entry.steps.filter((step) => step.kind === 'assert').map((step) => step.id)).toEqual(
        expect.arrayContaining(['nonnegative_balance', 'bounded_balance'])
      )
      const operations = writes(app, id)
      const balance = operations.find((step) => step.entityId === 'business-inventory-balances')
      const movement = operations.find((step) => step.entityId === 'business-inventory-movements')
      expect(balance?.operation).toBe('update')
      expect(balance?.values.map((value) => value.field)).toEqual(['quantity', 'version'])
      expect(movement?.operation).toBe('insert')
      expect(movement?.values.find((value) => value.field === 'actor_subject')?.value).toEqual({
        kind: 'caller-sub'
      })
      expect(movement?.values.map((value) => value.field)).toEqual(
        expect.arrayContaining([
          'source_id',
          'quantity_delta',
          'before_quantity',
          'after_quantity',
          'note'
        ])
      )
    }
    const allWrites =
      app.commands?.commands
        .flatMap((entry) => entry.steps)
        .filter(
          (step) => step.kind === 'data.mutate' && step.entityId === 'business-inventory-movements'
        ) ?? []
    expect(allWrites).toHaveLength(5)
    expect(allWrites.every((step) => step.operation === 'insert')).toBe(true)
  })

  test('caps cumulative receiving and each return against the locked original document', () => {
    const app = inventory()
    for (const id of [
      'receive-inventory-purchase',
      'return-inventory-purchase',
      'cancel-inventory-purchase'
    ]) {
      const entry = command(app, id)
      expect(
        entry.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
      ).toEqual(['balance', 'purchase'])
      expect(entry.steps.map((step) => step.id)).toEqual(
        expect.arrayContaining(['purchase_balance_matches', 'purchase_ordered'])
      )
    }
    for (const id of ['receive-inventory-purchase', 'return-inventory-purchase'])
      expect(command(app, id).steps.some((step) => step.id === 'bounded_purchase_quantity')).toBe(
        true
      )
    expect(command(app, 'return-inventory-dispatch').steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['dispatch_balance_matches', 'bounded_return_quantity'])
    )
    expect(
      command(app, 'cancel-inventory-purchase').steps.some((step) => step.id === 'not_received')
    ).toBe(true)
    expect(writes(app, 'cancel-inventory-purchase')[0]?.values).toEqual(
      expect.arrayContaining([
        { field: 'cancelled_by', value: { kind: 'caller-sub' } },
        { field: 'cancelled_at', value: { kind: 'server-now' } }
      ])
    )
    // Existing obligations remain actionable even if the catalog was subsequently disabled.
    for (const id of [
      'receive-inventory-purchase',
      'return-inventory-purchase',
      'return-inventory-dispatch'
    ])
      expect(command(app, id).steps.some((step) => step.id === 'active_sku')).toBe(false)
    for (const id of ['create-inventory-purchase', 'issue-inventory-stock'])
      expect(command(app, id).steps.map((step) => step.id)).toEqual(
        expect.arrayContaining(['active_sku', 'active_warehouse'])
      )
  })

  test('uses server arithmetic and refuses stale or unexplained physical counts', () => {
    const app = inventory()
    const purchase = command(app, 'create-inventory-purchase')
    expect(purchase.parameters.map((parameter) => parameter.name)).not.toContain('totalCostCents')
    expect(
      writes(app, purchase.id)[0]?.values.find((value) => value.field === 'total_cost_cents')?.value
    ).toEqual({
      kind: 'integer-arithmetic',
      operator: 'multiply',
      left: { kind: 'parameter', name: 'quantity' },
      right: { kind: 'parameter', name: 'unitCostCents' }
    })
    const adjust = command(app, 'adjust-inventory-stock')
    expect(adjust.steps.map((step) => step.id)).toEqual(
      expect.arrayContaining(['current_count_version', 'count_changed', 'count_reason_required'])
    )
    expect(
      adjust.parameters.find((parameter) => parameter.name === 'countedQuantity')
    ).toMatchObject({ type: 'integer', min: 0, max: 2147483647 })
    const forged = inventory()
    const write = writes(forged, 'issue-inventory-stock').find(
      (step) => step.entityId === 'business-inventory-dispatches'
    )
    const owner = write?.values.find((value) => value.field === 'owner_id')
    if (!owner) throw new Error('Missing dispatch owner')
    owner.value = { kind: 'parameter', name: 'balanceId' }
    expect(parseBackendApplicationSpecV1(forged).ok).toBe(false)
  })

  test('emits trusted PostgreSQL constraints, resources and command plans with the ordinary runtime', () => {
    const files = modelFiles(inventory())
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('UNIQUE ("sku_id", "warehouse_id")')
    expect(sql).toContain('FOREIGN KEY ("balance_id", "owner_id")')
    expect(sql).toContain('"inventory_movements"')
    const plans = files.get('backend/nestjs/src/command-plans.ts')
    for (const id of stockCommands) expect(plans).toContain(id)
    expect(files.get('backend/nestjs/src/resources/inventory-balances.service.ts')).toContain(
      'inventory-operator'
    )
    expect(files.get('backend/nestjs/src/command.service.ts')).toContain('executeCommand')
    expect(files.has('backend/nestjs/src/inventory-execution.ts')).toBe(false)
  })

  test('adds inventory to CRM without changing existing authority or coupling commerce stock', async () => {
    const from = createBusinessApplication('inventory-crm', authentication, 'customer-crm')
    const before = structuredClone(from)
    const to = composeBusinessModules(from, ['customer-crm', 'procurement-inventory'], {
      adoptExisting: ['customer-crm']
    }).application
    expect(from).toEqual(before)
    expect(parseBackendApplicationSpecV1(to).diagnostics).toEqual([])
    for (const policy of before.auth.rowAccess)
      expect(to.auth.rowAccess.find((entry) => entry.id === policy.id)).toEqual(policy)
    const module = to.modules?.modules.find((entry) => entry.id === 'procurement-inventory')
    expect(module?.entityIds).toHaveLength(7)
    expect(module?.commandIds).toHaveLength(14)
    expect(module?.dependsOn).toEqual(['shared-accounts'])
    const migration = await planNestJSLocalPreviewMigration({
      fromApplication: from,
      toApplication: to
    })
    expect(migration.ok, migration.ok ? undefined : JSON.stringify(migration.diagnostics)).toBe(
      true
    )
    if (!migration.ok) throw new Error('Inventory addition was not additive')
    expect(migration.plan.sql).toContain('CREATE TABLE "public"."inventory_balances"')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."customers"')
  })
})
