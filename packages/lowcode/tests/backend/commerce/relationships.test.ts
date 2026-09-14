import { describe, expect, test } from 'bun:test'

import {
  parseBackendApplicationSpecV1,
  commerceEntityForeignKeys
} from '@open-pencil/lowcode/backend'

import { commerceApplication, required } from './fixture'

function rejected(application: unknown): void {
  const parsed = parseBackendApplicationSpecV1(application)
  expect(parsed.ok).toBe(false)
  expect(parsed.diagnostics.some((entry) => entry.code === 'backend-commerce-invalid')).toBe(true)
}

describe('commerce private relationships and settlement ownership', () => {
  test('uses buyer-composite foreign keys without exposing settlements to the buyer', () => {
    const app = commerceApplication()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    const settlement = required(app.dataModel.entities.find((entry) => entry.id === 'settlements'))
    expect(settlement.fields).toContainEqual({
      id: 'merchant_id',
      name: 'merchant_id',
      type: 'uuid',
      nullable: false
    })
    expect(commerceEntityForeignKeys('settlements', app.commerce.entities)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: ['order_id', 'owner_id'],
          targetEntityId: 'orders',
          targetFields: ['id', 'owner_id']
        }),
        expect.objectContaining({
          fields: ['payment_group_id', 'owner_id'],
          targetEntityId: 'payment_groups',
          targetFields: ['id', 'owner_id']
        }),
        expect.objectContaining({
          fields: ['store_id'],
          targetEntityId: 'stores',
          targetFields: ['id']
        })
      ])
    )
    app.auth.rowAccess.push({
      id: 'buyer-settlement',
      entityId: 'settlements',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: 'settlements-owner' }
    })
    rejected(app)
  })

  test('rejects missing, single-column, or remapped private owner relationships', () => {
    for (const entityId of [
      'cart_items',
      'orders',
      'order_items',
      'refunds',
      'shipments',
      'settlements'
    ]) {
      const app = commerceApplication()
      const entity = required(app.dataModel.entities.find((entry) => entry.id === entityId))
      const relation = required(
        entity.foreignKeys?.find((entry) => entry.fields.includes('owner_id'))
      )
      relation.fields = [required(relation.fields[0])]
      relation.targetFields = ['id']
      rejected(app)
    }
    const missing = commerceApplication()
    required(missing.dataModel.entities.find((entry) => entry.id === 'orders')).foreignKeys = []
    rejected(missing)
    const remapped = commerceApplication()
    const entity = required(remapped.dataModel.entities.find((entry) => entry.id === 'settlements'))
    const relation = required(
      entity.foreignKeys?.find((entry) => entry.fields.includes('order_id'))
    )
    relation.fields = ['order_id', 'merchant_id']
    rejected(remapped)
  })

  test('requires compound target uniqueness and non-null immutable merchant snapshot type', () => {
    const missingUnique = commerceApplication()
    const orders = required(missingUnique.dataModel.entities.find((entry) => entry.id === 'orders'))
    orders.uniques = orders.uniques?.filter((entry) => !entry.fields.includes('id'))
    rejected(missingUnique)
    for (const patch of [
      { nullable: true },
      { type: 'string' },
      { default: { kind: 'generated', generator: 'uuid' } }
    ]) {
      const app = commerceApplication()
      const settlement = required(
        app.dataModel.entities.find((entry) => entry.id === 'settlements')
      )
      Object.assign(required(settlement.fields.find((entry) => entry.id === 'merchant_id')), patch)
      rejected(app)
    }
  })
})
