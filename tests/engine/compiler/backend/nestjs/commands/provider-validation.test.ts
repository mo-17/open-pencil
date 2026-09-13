import { describe, expect, test } from 'bun:test'

import { validateNestJSCommands } from '#compiler/backend/nestjs/commands/provider-validation'
import { validateNestJSApplication } from '#compiler/backend/nestjs/validation'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { modelPlan, normalizeModelApplication } from '../model-capabilities/helpers'
import { commandApplication } from './helpers'

function temporalApplication(type: 'date' | 'datetime', value: string | null) {
  const application = commandApplication()
  const command = application.commands?.commands[0]
  if (!command) throw new Error('Missing command fixture')
  application.dataModel.entities[0].fields.push({
    id: 'moment',
    name: 'moment',
    type,
    nullable: true
  })
  const update = command.steps[1]
  if (update.kind !== 'data.mutate') throw new Error('Missing update fixture')
  update.values = [{ field: 'moment', value: { kind: 'literal', value } }]
  update.fields = ['id', 'moment']
  command.return.fields = ['id', 'moment']
  return application
}

function normalized(application: BackendApplicationSpecV1) {
  const result = normalizeModelApplication(application)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.value
}

describe('NestJS command provider semantic boundary', () => {
  test.each([
    '0001-01-01T00:00:00+14:00',
    '9999-12-31T23:59:59-14:00',
    '2026-09-12T01:02:03.1234567Z',
    '0000-01-01T00:00:00Z'
  ])('rejects shared-valid datetime assignment outside provider representation: %s', (value) => {
    const application = normalized(temporalApplication('datetime', value))
    expect(
      validateNestJSCommands(application).some((entry) => entry.path.includes('.values['))
    ).toBe(true)
    expect(modelPlan(application).ok).toBe(false)
  })

  test('rejects a shared-valid date with year zero', () => {
    const application = normalized(temporalApplication('date', '0000-01-01'))
    expect(validateNestJSCommands(application)).toHaveLength(1)
    expect(validateNestJSApplication(application).length).toBeGreaterThan(0)
  })

  test.each([
    '0001-01-01T14:00:00+14:00',
    '9999-12-31T09:59:59.999999-14:00',
    '2026-09-12T01:02:03.123456+08:00',
    null
  ])('accepts bounded offset timestamps and nullable literal: %s', (value) => {
    const application = normalized(temporalApplication('datetime', value))
    expect(validateNestJSCommands(application)).toEqual([])
    expect(modelPlan(application).ok).toBe(true)
  })

  test.each(['left', 'right'] as const)('checks typed assertion temporal literal on %s', (side) => {
    const application = temporalApplication('datetime', null)
    const command = application.commands?.commands[0]
    const read = command?.steps[0]
    if (!command || read?.kind !== 'data.read') throw new Error('Missing read fixture')
    read.fields.push('moment')
    const literal = { kind: 'literal' as const, value: '9999-12-31T23:59:59-14:00' }
    const result = { kind: 'result' as const, name: read.resultName, field: 'moment' }
    command.steps.splice(1, 0, {
      id: 'check',
      kind: 'assert',
      operator: 'eq',
      error: 'conflict',
      left: side === 'left' ? literal : result,
      right: side === 'right' ? literal : result
    })
    const diagnostics = validateNestJSCommands(normalized(application))
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].path.endsWith('.' + side)).toBe(true)
  })

  test.each(['/_openpencil', '/_OPENPENCIL/command'])(
    'reserves connected-preview paths: %s',
    (path) => {
      const application = commandApplication()
      const command = application.commands?.commands[0]
      if (!command) throw new Error('Missing command fixture')
      command.path = path
      expect(
        validateNestJSCommands(normalized(application)).some((entry) =>
          entry.message.includes('namespace')
        )
      ).toBe(true)
    }
  )

  test.each(['openpencil_command_requests', 'openpencil_command_requests_pkey'])(
    'reserves ledger SQL relation names: %s',
    (name) => {
      const application = commandApplication()
      application.dataModel.entities[0].name = name
      expect(
        validateNestJSCommands(normalized(application)).some((entry) =>
          entry.message.includes('SQL names')
        )
      ).toBe(true)
      delete application.commands
      expect(validateNestJSCommands(application)).toEqual([])
    }
  )
})
