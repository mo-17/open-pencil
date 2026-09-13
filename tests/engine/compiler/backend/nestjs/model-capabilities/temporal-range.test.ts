import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { NESTJS_UTC_RANGE_VALIDATOR_SOURCE } from '#compiler/backend/nestjs/dto'
import { nestJSValidTemporalLiteral } from '#compiler/backend/nestjs/schema-fields'

import type { DataFieldIR } from '@open-pencil/lowcode/backend'

import { browserApplication } from '../browser-client/helpers'
import { modelFiles, modelPlan, normalizeModelApplication } from './helpers'

const timestamp: DataFieldIR = { id: 'at', name: 'at', type: 'datetime', nullable: true }
const generatedValidator = runInNewContext(
  new Bun.Transpiler({ loader: 'ts' }).transformSync(NESTJS_UTC_RANGE_VALIDATOR_SOURCE) +
    '\nIsUTCDateTimeRange()',
  {
    ValidateBy: (definition: { validator: { validate(value: unknown): boolean } }) =>
      definition.validator
  }
) as { validate(value: unknown): boolean }

describe('NestJS timestamp UTC range', () => {
  test.each([
    '0001-01-01T00:00:00.000001Z',
    '0001-01-01T14:00:00+14:00',
    '9999-12-31T23:59:59.999999Z',
    '9999-12-31T09:59:59.999999-14:00',
    '2026-09-12T02:43:30.123456+08:00'
  ])('keeps supported offset and microsecond input %s', (value) => {
    expect(nestJSValidTemporalLiteral(timestamp, value)).toBe(true)
    expect(generatedValidator.validate(value)).toBe(true)
  })

  test.each([
    '0001-01-01T00:00:00+14:00',
    '0001-01-01T13:59:59.999999+14:00',
    '9999-12-31T23:59:59-14:00',
    '9999-12-31T10:00:00-14:00'
  ])('rejects UTC overflow in literal defaults and emitted DTO validator %s', (value) => {
    expect(nestJSValidTemporalLiteral(timestamp, value)).toBe(false)
    expect(generatedValidator.validate(value)).toBe(false)
    const application = browserApplication()
    application.dataModel.entities[0].fields.push({
      ...timestamp,
      default: { kind: 'literal', value }
    })
    const parsed = normalizeModelApplication(application)
    expect(parsed.ok ? modelPlan(parsed.value).ok : parsed.ok).toBe(false)
  })

  test('attaches the range validator to writable timestamp DTO fields', () => {
    const application = browserApplication()
    application.dataModel.entities[0].fields.push(timestamp)
    application.httpApi?.resources[0].createFields?.push('at')
    const files = modelFiles(application)
    expect(String(files.get('backend/nestjs/src/resources/notes-api.dto.ts'))).toContain(
      '@IsUTCDateTimeRange()'
    )
  })

  test('security artifact describes the actual explicit policy union without asserting database RLS', () => {
    const files = modelFiles(browserApplication())
    const policy = JSON.parse(String(files.get('backend/nestjs/security-policy.json')))
    expect(policy.enforcement).toBe('server-explicit-policy-predicates')
    expect(policy.policyCombination).toBe(
      'OR-of-explicit-owner-role-and-select-only-anonymous-grants'
    )
    expect(policy.databaseRLS).toBe(false)
    expect(policy.roleClaim).toBe('verified-jwt-top-level-openpencil_roles')
  })
})
