import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  type BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

import { commandApplication } from '../commands/fixture'
import { commerceApplication, required } from './fixture'

function rejected(application: unknown, code = 'backend-commerce-invalid') {
  const parsed = parseBackendApplicationSpecV1(application)
  expect(parsed.ok).toBe(false)
  expect(parsed.diagnostics.some((entry) => entry.code === code)).toBe(true)
}

describe('commerce authority boundaries', () => {
  test('rejects HTTP state writes and catalog stock replacement', () => {
    for (const entityId of [
      'carts',
      'cart_items',
      'payment_groups',
      'orders',
      'order_items',
      'refunds',
      'shipments',
      'settlements'
    ]) {
      const app = commerceApplication()
      const resource = required(app.httpApi.resources.find((entry) => entry.entityId === entityId))
      resource.operations.push('delete')
      rejected(app)
    }
    const app = commerceApplication()
    const resource = required(app.httpApi.resources.find((entry) => entry.entityId === 'products'))
    resource.operations.push('update')
    resource.updateFields = ['stock']
    rejected(app)
    const store = commerceApplication()
    const storeResource = required(
      store.httpApi.resources.find((entry) => entry.entityId === 'stores')
    )
    storeResource.operations.push('create')
    storeResource.createFields = ['title', 'single_store']
    rejected(store)
  })

  test('rejects an otherwise valid ordinary command that writes inventory', () => {
    const app = commerceApplication()
    const command: BackendCommandDefinitionIR = {
      id: 'unsafe-stock',
      name: 'Unsafe stock',
      path: '/commands/unsafe-stock',
      access: { kind: 'authenticated' },
      idempotency: { kind: 'required', header: 'Idempotency-Key' },
      parameters: [{ name: 'id', type: 'uuid', required: true }],
      steps: [
        {
          id: 'read',
          kind: 'data.read',
          entityId: 'products',
          resultName: 'product',
          fields: ['id', 'stock'],
          key: { kind: 'parameter', name: 'id' },
          scope: 'owner',
          lock: 'update'
        },
        {
          id: 'write',
          kind: 'data.mutate',
          operation: 'update',
          entityId: 'products',
          record: 'product',
          resultName: 'changed',
          fields: ['id'],
          values: [{ field: 'stock', value: { kind: 'literal', value: 0 } }]
        }
      ],
      return: { resultName: 'changed', fields: ['id'] }
    }
    app.commands.commands.push(command)
    rejected(app)
  })

  test('rejects nested workflow bypasses of commerce writes', () => {
    const app = commerceApplication()
    app.workflows.workflows.push({
      id: 'bypass',
      name: 'Bypass',
      trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
      parameters: ['orderId'],
      steps: [
        {
          id: 'branch',
          kind: 'branch',
          condition: 'true',
          consequent: [
            {
              id: 'unsafe',
              kind: 'data.mutate',
              operation: 'update',
              entityId: 'orders',
              filters: [
                {
                  field: 'id',
                  operator: 'eq',
                  value: { kind: 'expression', expression: 'orderId' }
                }
              ],
              values: [{ field: 'status', value: { kind: 'expression', expression: '"paid"' } }]
            }
          ],
          alternate: []
        }
      ]
    })
    rejected(app)
  })

  test('rejects broad financial reads and alternate write policies', () => {
    const app = commerceApplication()
    app.auth.rowAccess.push({
      id: 'all-orders',
      entityId: 'orders',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'authenticated' }
    })
    rejected(app)
    const write = commerceApplication()
    required(write.auth.rowAccess.find((entry) => entry.entityId === 'orders')).operations.push(
      'update'
    )
    rejected(write)
    const cart = commerceApplication()
    cart.auth.rowAccess.push({
      id: 'operator-cart',
      entityId: 'carts',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'role', roleId: 'commerce-operator' }
    })
    rejected(cart)
  })

  test('keeps public metadata separate from private owner identity projections', () => {
    const app = commerceApplication()
    app.auth.rowAccess.push({
      id: 'public-stores',
      entityId: 'stores',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'authenticated' }
    })
    const resource = required(app.httpApi.resources.find((entry) => entry.entityId === 'stores'))
    resource.readFields.push('owner_id')
    rejected(app)
    resource.readPolicyIds = ['stores-owner-read']
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.ok).toBe(true)
  })

  test('rejects financial history deletion through foreign key cascades', () => {
    const app = commerceApplication()
    required(app.dataModel.entities.find((entry) => entry.id === 'orders')).foreignKeys = [
      {
        id: 'group',
        fields: ['payment_group_id'],
        targetEntityId: 'payment_groups',
        targetFields: ['id'],
        onDelete: 'cascade'
      }
    ]
    rejected(app)
  })

  test('retains ordinary command mutation and string bounds', () => {
    const app = commandApplication()
    required(app.commands?.commands[0]).steps = []
    rejected(app, 'backend-command-invalid')
    const oversized = commandApplication()
    required(oversized.commands?.commands[0]).parameters.push({
      name: 'address',
      type: 'string',
      required: true,
      maxLength: 8193
    })
    rejected(oversized, 'backend-command-invalid')
  })

  test('rejects malformed amounts, resource bounds and role collisions', () => {
    for (const patch of [
      { commissionBasisPoints: -1 },
      { commissionBasisPoints: 10001 },
      { commissionBasisPoints: 0.5 },
      { maxItems: 51 },
      { maxStores: 11 },
      { maxStores: 10, maxItems: 1 },
      { reservationSeconds: 59 },
      { settlementDelaySeconds: 7776001 }
    ]) {
      const app = commerceApplication()
      const parsed = parseBackendApplicationSpecV1({
        ...app,
        commerce: { ...app.commerce, ...patch }
      })
      expect(parsed.ok).toBe(false)
    }
    const app = commerceApplication()
    app.commerce.roles.operator = 'merchant'
    rejected(app)
  })
})
