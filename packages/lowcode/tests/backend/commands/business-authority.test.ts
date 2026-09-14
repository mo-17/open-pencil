import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { commandApplication, insertStep, parameter, readStep, required, result } from './fixture'

function fixture() {
  const application = commandApplication()
  const command = required(application.commands).commands[0]
  required(application.httpApi).resources[0].operations = required(
    application.httpApi
  ).resources[0].operations.filter((operation) => operation !== 'delete')
  application.dataModel.entities[0].fields.push({
    id: 'assignee',
    name: 'assignee',
    type: 'uuid',
    nullable: false
  })
  application.auth.rowAccess.push({
    id: 'assigned',
    entityId: 'notes',
    effect: 'allow',
    operations: ['select'],
    principal: {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: 'notes',
      membershipFieldId: 'id',
      identityFieldId: 'assignee',
      conditions: [{ fieldId: 'status', value: 'active' }]
    }
  })
  command.access = {
    kind: 'row-policy',
    entityId: 'notes',
    parameter: 'productId',
    policyIds: ['assigned']
  }
  return { application, command }
}

describe('business command authority contracts', () => {
  test('inherits an authorized locked parent owner only through its complete composite foreign key', () => {
    const { application, command } = fixture()
    const parent = application.dataModel.entities[0]
    parent.uniques = [{ id: 'parent-owner', fields: ['id', 'owner_id'] }]
    application.dataModel.entities[1].foreignKeys = [
      {
        id: 'order-parent',
        fields: ['product_id', 'owner_id'],
        targetEntityId: parent.id,
        targetFields: ['id', 'owner_id'],
        onDelete: 'restrict'
      }
    ]
    readStep(command.steps[0]).fields.push('owner_id')
    const insert = insertStep(command.steps[4])
    const owner = required(insert.values.find((entry) => entry.field === 'owner_id'))
    owner.value = result('product', 'owner_id')
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const policy = required(application.auth.rowAccess.find((entry) => entry.id === 'assigned'))
    const principal = policy.principal
    policy.principal = { kind: 'anonymous' }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    policy.principal = principal
    command.access = { kind: 'authenticated' }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
    command.access = {
      kind: 'row-policy',
      entityId: parent.id,
      parameter: 'productId',
      policyIds: ['assigned']
    }
    required(insert.values.find((entry) => entry.field === 'product_id')).value =
      parameter('productId')
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('bounds expanded content and transaction steps without accepting arbitrary growth', () => {
    const { application, command } = fixture()
    command.parameters.push({ name: 'body', type: 'string', required: true, maxLength: 8192 })
    while (command.steps.length < 32)
      command.steps.splice(1, 0, {
        id: 'bounded-' + command.steps.length,
        kind: 'assert',
        left: { kind: 'literal', value: 1 },
        operator: 'eq',
        right: { kind: 'literal', value: 1 },
        error: 'conflict'
      })
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    command.steps.splice(1, 0, {
      id: 'too-many',
      kind: 'assert',
      left: { kind: 'literal', value: 1 },
      operator: 'eq',
      right: { kind: 'literal', value: 1 },
      error: 'conflict'
    })
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('accepts bounded current-assignee authority and preserves its fixed conditions', () => {
    const { application } = fixture()
    const parsed = parseBackendApplicationSpecV1(application)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
    expect(
      parsed.value.auth.rowAccess.find((entry) => entry.id === 'assigned')?.principal.kind
    ).toBe('related-member')
  })
  test.each([
    'unknown-policy',
    'wrong-entity',
    'deny',
    'invalid-selector',
    'write-policy',
    'wrong-value',
    'unknown-field',
    'membership-write'
  ])('rejects %s', (variant) => {
    const { application, command } = fixture()
    const policy = required(application.auth.rowAccess.find((entry) => entry.id === 'assigned'))
    if (variant === 'unknown-policy')
      command.access = {
        kind: 'row-policy',
        entityId: 'notes',
        parameter: 'productId',
        policyIds: ['missing']
      }
    if (variant === 'wrong-entity') policy.entityId = 'orders'
    if (variant === 'deny') policy.effect = 'deny'
    if (variant === 'invalid-selector')
      command.parameters[0] = { name: 'productId', type: 'string', required: true, maxLength: 36 }
    if (variant === 'write-policy') policy.operations.push('update')
    if (variant === 'wrong-value') policy.conditions = [{ fieldId: 'stock', value: 'ten' }]
    if (variant === 'unknown-field') policy.conditions = [{ fieldId: 'missing', value: true }]
    if (variant === 'membership-write')
      required(application.httpApi).resources[0].updateFields?.push('assignee')
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('accepts server time and typed datetime comparisons, rejects arithmetic on clocks', () => {
    const { application, command } = fixture()
    command.parameters.push({ name: 'startsAt', type: 'datetime', required: true })
    command.steps.splice(1, 0, {
      id: 'future',
      kind: 'assert',
      left: parameter('startsAt'),
      operator: 'gte',
      right: { kind: 'server-now' },
      error: 'conflict'
    })
    command.steps.splice(2, 0, {
      id: 'different-person',
      kind: 'assert',
      left: result('product', 'id'),
      operator: 'neq',
      right: { kind: 'caller-sub' },
      error: 'conflict'
    })
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const assertion = command.steps[1]
    if (assertion.kind !== 'assert') throw new Error('Expected assertion')
    assertion.left = {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: { kind: 'server-now' },
      right: { kind: 'literal', value: 1 }
    }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
  test('does not allow server time as a UUID row selector', () => {
    const { application, command } = fixture()
    readStep(command.steps[0]).key = { kind: 'server-now' }
    expect(parseBackendApplicationSpecV1(application).ok).toBe(false)
  })
})
