import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'
import { validateNestJSCommands } from '#compiler/backend/nestjs/commands/provider-validation'

import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

import { normalizeModelApplication } from '../model-capabilities/helpers'
import {
  COMMAND_SUBJECT,
  commandApplication,
  commandRuntime,
  type RuntimeCommandQuery
} from './helpers'

const UUID = 'abcdef01-1234-4567-89ab-abcdefabcdef'

function typedApplication(literal: string) {
  const application = commandApplication()
  const command = application.commands?.commands[0]
  const read = command?.steps[0]
  const update = command?.steps[1]
  if (!command || read?.kind !== 'data.read' || update?.kind !== 'data.mutate')
    throw new Error('Missing command fixture')
  application.dataModel.entities[0].fields.push(
    { id: 'moment', name: 'event_time', type: 'datetime', nullable: true },
    { id: 'ratio', name: 'numeric_value', type: 'number', nullable: true }
  )
  read.fields.push('moment', 'ratio')
  update.fields.push('moment', 'ratio')
  command.return.fields.push('moment', 'ratio')
  command.steps.splice(1, 0, {
    id: 'same-moment',
    kind: 'assert',
    operator: 'eq',
    error: 'conflict',
    left: { kind: 'result', name: read.resultName, field: 'moment' },
    right: { kind: 'literal', value: literal }
  })
  return application
}

function plan(application: BackendApplicationSpecV1) {
  const parsed = normalizeModelApplication(application)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics))
  const command = parsed.value.commands?.commands[0]
  if (!command) throw new Error('Missing normalized command')
  expect(validateNestJSCommands(parsed.value)).toEqual([])
  return nestJSCommandPlan(parsed.value, command)
}

describe('generated command typed comparisons and scalar projections', () => {
  let runtime: Awaited<ReturnType<typeof commandRuntime>>
  beforeAll(async () => {
    runtime = await commandRuntime()
  })
  afterAll(async () => {
    await runtime.dispose()
  })

  test.each([
    ['2026-09-12T08:02:03+08:00', '2026-09-12T00:02:03.000000Z'],
    ['2026-09-12T08:02:03.123456+08:00', '2026-09-12T00:02:03.123456Z'],
    ['2026-09-12T00:02:03.1Z', '2026-09-12T00:02:03.100000Z'],
    ['0001-01-01T14:00:00.000001+14:00', '0001-01-01T00:00:00.000001Z'],
    ['9999-12-31T09:59:59.999999-14:00', '9999-12-31T23:59:59.999999Z']
  ])('compares a typed timestamp by its UTC microsecond value: %s', async (literal, moment) => {
    const compiled = plan(typedApplication(literal))
    const queries: RuntimeCommandQuery[] = []
    const row = { id: UUID, title: 'After', moment, ratio: 1.25 }
    const response = await runtime.execution.executeCommand(
      {
        query: async (text, values = []) => {
          queries.push({ text, values })
          return { rowCount: 1, rows: [row] }
        }
      },
      compiled,
      { noteId: UUID, title: 'After' },
      COMMAND_SUBJECT
    )
    expect(queries).toHaveLength(2)
    expect(queries[0].text).toContain('to_char("event_time" AT TIME ZONE \'UTC\'')
    expect(queries[0].text).toContain('AS "moment"')
    expect(queries[0].text).toContain('"numeric_value" AS "ratio"')
    expect(response).toEqual(row)
  })

  test('does not round away a distinct timestamp within the same millisecond', async () => {
    let queries = 0
    await expect(
      runtime.execution.executeCommand(
        {
          query: async () => {
            queries += 1
            return {
              rowCount: 1,
              rows: [
                { id: UUID, title: 'Before', moment: '2026-09-12T00:02:03.123457Z', ratio: 1.25 }
              ]
            }
          }
        },
        plan(typedApplication('2026-09-12T08:02:03.123456+08:00')),
        { noteId: UUID, title: 'After' },
        COMMAND_SUBJECT
      )
    ).rejects.toThrow('Request conflict')
    expect(queries).toBe(1)
  })

  test.each(['result', 'parameter', 'caller-sub'] as const)(
    'normalizes typed UUID equality against %s',
    async (kind) => {
      const application = commandApplication()
      const command = application.commands?.commands[0]
      if (!command) throw new Error('Missing command fixture')
      const source = (() => {
        if (kind === 'result') return { kind, name: 'note', field: 'id' }
        if (kind === 'parameter') return { kind, name: 'noteId' }
        return { kind }
      })()
      command.steps.splice(1, 0, {
        id: 'uuid-check',
        kind: 'assert',
        left: { kind: 'literal', value: UUID.toUpperCase() },
        right: source,
        operator: 'eq',
        error: 'conflict'
      })
      const response = await runtime.execution.executeCommand(
        { query: async () => ({ rowCount: 1, rows: [{ id: UUID, title: 'After' }] }) },
        plan(application),
        { noteId: UUID, title: 'After' },
        UUID
      )
      expect(response.id).toBe(UUID)
    }
  )

  test('leaves two untyped string literals unchanged', () => {
    const application = commandApplication()
    const command = application.commands?.commands[0]
    if (!command) throw new Error('Missing command fixture')
    const assertion: BackendCommandDefinitionIR['steps'][number] = {
      id: 'text-check',
      kind: 'assert',
      operator: 'eq',
      error: 'conflict',
      left: { kind: 'literal', value: UUID.toUpperCase() },
      right: { kind: 'literal', value: UUID }
    }
    command.steps.splice(1, 0, assertion)
    const compiled = plan(application).steps[1]
    expect(compiled.kind).toBe('assert')
    if (compiled.kind !== 'assert') throw new Error('Missing compiled assertion')
    expect(compiled.left).toEqual(assertion.left)
    expect(compiled.right).toEqual(assertion.right)
    expect('id' in compiled).toBe(false)
  })
})
