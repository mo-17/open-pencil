import { describe, expect, test } from 'bun:test'

import { authorizationRuntime, RECORD, SUBJECT } from '../authorization/helpers'
import {
  commandApplication,
  commandRuntime,
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  type RuntimeCommandQuery
} from '../commands/helpers'

function application() {
  const app = commandApplication()
  const entity = app.dataModel.entities[0]
  entity.fields.push(
    { id: 'assignee', name: 'assignee', type: 'uuid', nullable: false },
    { id: 'active', name: 'active', type: 'boolean', nullable: false }
  )
  app.auth.rowAccess.push({
    id: 'assigned',
    entityId: entity.id,
    effect: 'allow',
    operations: ['select'],
    principal: {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: entity.id,
      membershipFieldId: 'id',
      identityFieldId: 'assignee',
      conditions: [{ fieldId: 'active', value: true }]
    }
  })
  const command = app.commands?.commands[0]
  if (!command || !app.httpApi) throw new Error('Missing fixture')
  command.access = {
    kind: 'row-policy',
    entityId: entity.id,
    parameter: 'noteId',
    policyIds: ['assigned']
  }
  app.httpApi.resources[0].readPolicyIds = ['assigned']
  return app
}

describe('generated current row authority', () => {
  test('checks current membership after the parent lock and before both fresh and replayed ledger access', async () => {
    const runtime = await commandRuntime(application())
    const calls: RuntimeCommandQuery[] = []
    const saved: Record<string, unknown> = {}
    let allowed = true
    const service = new runtime.service.CommandService({
      transaction: async (operation) =>
        operation({
          async query(text, values = []) {
            calls.push({ text, values })
            if (text.includes('EXISTS (SELECT'))
              return { rowCount: allowed ? 1 : 0, rows: allowed ? [{ id: COMMAND_ITEM }] : [] }
            if (text.startsWith('INSERT INTO public.openpencil_command_requests')) {
              if (saved.response_json) return { rowCount: 0, rows: [] }
              saved.command_digest = values[4]
              saved.request_digest = values[5]
              return { rowCount: 1, rows: [{ request_key: values[3] }] }
            }
            if (text.startsWith('SELECT command_digest')) return { rowCount: 1, rows: [saved] }
            if (text.startsWith('UPDATE public.openpencil_command_requests')) {
              saved.response_json = values[4]
              return { rowCount: 1, rows: [] }
            }
            return { rowCount: 1, rows: [{ id: COMMAND_ITEM, title: 'Renamed' }] }
          }
        })
    })
    const body = { noteId: COMMAND_ITEM, title: 'Renamed' }
    const principal = { subject: COMMAND_SUBJECT, roles: [] }
    try {
      const result = await service.execute(runtime.plan, principal, 'row-policy-key-0001', body)
      expect(calls[0].text).toEndWith('WHERE "id" = $1 FOR UPDATE')
      expect(calls[1].text).toContain(
        'EXISTS (SELECT 1 FROM "public"."notes" AS "__openpencil_member"'
      )
      expect(calls[1].values).toEqual([COMMAND_ITEM, COMMAND_SUBJECT, true])
      expect(calls[2].text).toStartWith('INSERT INTO public.openpencil_command_requests')
      calls.length = 0
      expect(await service.execute(runtime.plan, principal, 'row-policy-key-0001', body)).toEqual(
        result
      )
      expect(calls[0].text).toContain('FOR UPDATE')
      expect(calls[1].text).toContain('EXISTS')
      allowed = false
      calls.length = 0
      await expect(
        service.execute(runtime.plan, principal, 'row-policy-key-0001', body)
      ).rejects.toThrow('Access denied')
      expect(calls).toHaveLength(2)
      expect(calls.every((call) => !call.text.includes('openpencil_command_requests'))).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })

  test('public status constants remain ANDed inside their grant before owner OR composition', async () => {
    const app = application()
    if (!app.httpApi) throw new Error('Missing fixture')
    const resource = app.httpApi.resources[0]
    resource.readPolicyIds = undefined
    app.auth.rowAccess.push({
      id: 'published',
      entityId: resource.entityId,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' },
      conditions: [{ fieldId: 'title', value: "published' OR TRUE --" }]
    })
    const runtime = await authorizationRuntime('owner', app)
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const service = runtime.service({
      async query(sql, values) {
        calls.push({ sql, values })
        return { rows: [] }
      }
    })
    try {
      await expect(service.read(null, RECORD)).rejects.toThrow('Record not found')
      expect(calls[0].sql).toContain('"notes"."title" = $1')
      expect(calls[0].sql).not.toContain("published' OR TRUE")
      expect(calls[0].values).toEqual(["published' OR TRUE --", RECORD])
      await expect(service.read({ subject: SUBJECT, roles: [] }, RECORD)).rejects.toThrow(
        'Record not found'
      )
      expect(calls[1].sql).toContain(' OR ')
      expect(calls[1].sql).toContain('"__openpencil_member"."active" = $')
    } finally {
      runtime.dispose()
    }
  })

  test('normalizes microseconds and offsets and samples trusted time after preceding read locks', async () => {
    const app = commandApplication()
    const command = app.commands?.commands[0]
    if (!command) throw new Error('Missing command')
    command.parameters.push({ name: 'startsAt', type: 'datetime', required: true })
    command.steps.splice(1, 0, {
      id: 'future',
      kind: 'assert',
      left: { kind: 'parameter', name: 'startsAt' },
      operator: 'gte',
      right: { kind: 'server-now' },
      error: 'conflict'
    })
    const runtime = await commandRuntime(app)
    const calls: string[] = []
    try {
      const input = runtime.input.commandInput(command.parameters, {
        noteId: COMMAND_ITEM,
        title: 'Updated',
        startsAt: '2030-01-01T08:00:00.123456+08:00'
      })
      expect(input.startsAt).toBe('2030-01-01T00:00:00.123456Z')
      for (const startsAt of [
        '2030-02-30T00:00:00Z',
        '2030-01-01T00:00:00.1234567Z',
        '2030-01-01',
        '0000-01-01T00:00:00Z'
      ])
        expect(() =>
          runtime.input.commandInput(command.parameters, {
            noteId: COMMAND_ITEM,
            title: 'Updated',
            startsAt
          })
        ).toThrow('Invalid request')
      await expect(
        runtime.execution.executeCommand(
          {
            async query(text) {
              calls.push(text)
              return {
                rowCount: 1,
                rows: text.includes('clock_timestamp')
                  ? [{ now: '2030-01-01T00:00:00.123457Z' }]
                  : [{ id: COMMAND_ITEM, title: 'Original' }]
              }
            }
          },
          runtime.plan,
          input,
          COMMAND_SUBJECT
        )
      ).rejects.toThrow('Request conflict')
      expect(calls).toHaveLength(2)
      expect(calls[0]).toContain('FOR UPDATE')
      expect(calls[1]).toContain('clock_timestamp()')
      expect(calls.some((sql) => sql.startsWith('UPDATE'))).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })
})
