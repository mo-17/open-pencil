import { describe, expect, test } from 'bun:test'

import {
  canonicalBackendApplicationBytes,
  commerceCommandDefinition,
  commerceOperationEntityKey,
  COMMERCE_OPERATIONS,
  deriveBackendApplicationCapabilities,
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { backendApplicationFixture } from '../fixture'
import { httpApplicationV2 } from '../http-api/fixtures'
import { commerceApplication, required } from './fixture'

function expectInvalid(application: unknown, code = 'backend-commerce-invalid') {
  const parsed = parseBackendApplicationSpecV1(application)
  expect(parsed.ok).toBe(false)
  expect(parsed.diagnostics.some((entry) => entry.code === code)).toBe(true)
}

describe('closed commerce application contract', () => {
  for (const mode of ['single-merchant', 'multi-merchant'] as const)
    test('normalizes ' + mode + ' and all fixed operations', () => {
      const application = commerceApplication(mode)
      const parsed = parseBackendApplicationSpecV1(application)
      expect(parsed.diagnostics).toEqual([])
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.commands?.commands).toHaveLength(12)
      expect(parsed.value.commerce).toEqual(application.commerce)
      expect(deriveBackendApplicationCapabilities(parsed.value)).toEqual(
        expect.arrayContaining(['transactions.atomic', 'auth.roles', 'server.http', 'data.write'])
      )
      for (const operation of COMMERCE_OPERATIONS) {
        const command = required(
          parsed.value.commands?.commands.find((entry) => entry.commerceOperation === operation)
        )
        expect(command.steps).toEqual([])
        expect(command.return.resultName).toBe('result')
        expect(command.return.fields).not.toContain('owner_id')
        expect(application.commerce.entities[commerceOperationEntityKey(operation)]).toBeTruthy()
      }
      const reordered = structuredClone(application)
      reordered.commands.commands.reverse()
      reordered.dataModel.entities.reverse()
      for (const command of reordered.commands.commands) {
        command.parameters.reverse()
        command.return.fields.reverse()
      }
      expect(canonicalBackendApplicationBytes(reordered)).toEqual(
        canonicalBackendApplicationBytes(application)
      )
    })

  test('leaves commerce absent in legacy normalization and canonical output', () => {
    const parsed = parseBackendApplicationSpecV1(backendApplicationFixture())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(Object.hasOwn(parsed.value, 'commerce')).toBe(false)
    expect(new TextDecoder().decode(canonicalBackendApplicationBytes(parsed.value))).not.toContain(
      'commerce'
    )
  })

  test('explicitly rejects V2 declaration and V1 to V2 lowering', () => {
    const application = commerceApplication()
    const lowered = lowerBackendApplicationSpecV1ToV2(application)
    expect(lowered.ok).toBe(false)
    expect(
      lowered.diagnostics.some((entry) => entry.code === 'backend-commerce-v2-unsupported')
    ).toBe(true)
    const parsed = parseBackendApplicationSpecV2({
      ...httpApplicationV2(),
      commerce: application.commerce
    })
    expect(parsed.ok).toBe(false)
    expect(
      parsed.diagnostics.some((entry) => entry.code === 'backend-commerce-v2-unsupported')
    ).toBe(true)
  })

  test('rejects undeclared operations, executable extensions and missing commerce', () => {
    const application = commerceApplication()
    expectInvalid(
      { ...application, commerce: { ...application.commerce, handler: 'arbitrary' } },
      'backend-unknown-field'
    )
    const command = required(application.commands.commands[0])
    expectInvalid(
      {
        ...application,
        commands: {
          version: 1,
          commands: [{ ...command, commerceOperation: 'payment.real-transfer' }]
        }
      },
      'backend-enum-invalid'
    )
    const { commerce: _commerce, ...missing } = application
    expectInvalid(missing)
  })

  test('checks every fixed parameter, authority and result signature', () => {
    for (const operation of COMMERCE_OPERATIONS) {
      const application = commerceApplication()
      const command = commerceCommandDefinition(application.commerce, operation)
      application.commands.commands = [
        {
          ...command,
          parameters: [
            ...command.parameters,
            { name: 'amount', type: 'integer', required: true, min: 0, max: 999 }
          ]
        }
      ]
      expectInvalid(application)
      application.commands.commands = [
        {
          ...command,
          access:
            command.access.kind === 'authenticated'
              ? { kind: 'role', roleId: 'merchant' }
              : { kind: 'authenticated' }
        }
      ]
      expectInvalid(application)
      application.commands.commands = [
        {
          ...command,
          return: { ...command.return, fields: [...command.return.fields, 'owner_id'] }
        }
      ]
      expectInvalid(application)
    }
  })

  test('rejects schema drift, shared entity aliases and missing durable uniqueness', () => {
    const application = commerceApplication()
    application.commerce.entities.refunds = application.commerce.entities.orders
    expectInvalid(application, 'backend-duplicate')
    const schema = commerceApplication()
    const orders = required(schema.dataModel.entities.find((entry) => entry.id === 'orders'))
    required(orders.fields.find((entry) => entry.id === 'stock_released')).default = {
      kind: 'literal',
      value: true
    }
    expectInvalid(schema)
    const unique = commerceApplication('single-merchant')
    required(unique.dataModel.entities.find((entry) => entry.id === 'stores')).uniques = []
    expectInvalid(unique)
  })

  test('rejects duplicate operation endpoints and executable steps', () => {
    const application = commerceApplication()
    const command = required(application.commands.commands[0])
    application.commands.commands.push({ ...command, id: 'alias', path: '/commands/alias' })
    expectInvalid(application, 'backend-duplicate')
    const executable = commerceApplication()
    required(executable.commands.commands[0]).steps = [
      {
        id: 'bypass',
        kind: 'assert',
        left: { kind: 'literal', value: 1 },
        operator: 'eq',
        right: { kind: 'literal', value: 1 },
        error: 'conflict'
      }
    ]
    expectInvalid(executable, 'backend-command-invalid')
  })
})
