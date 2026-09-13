import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import {
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  commandRuntime,
  type RuntimeCommandDatabase,
  type RuntimeCommandQuery
} from './helpers'

describe('generated command idempotency boundary', () => {
  let loaded: Awaited<ReturnType<typeof commandRuntime>>
  beforeAll(async () => {
    loaded = await commandRuntime()
  })
  afterAll(async () => {
    await loaded.dispose()
  })

  test('checks authentication and command role before reading a stored result', async () => {
    let operations = 0
    const service = new loaded.service.CommandService({
      transaction: async () => {
        operations += 1
        throw new Error('Must not access database')
      }
    })
    await expect(service.execute(loaded.plan, null, 'request-key-00000001', {})).rejects.toThrow(
      'Authentication required'
    )
    await expect(
      service.execute(
        { ...loaded.plan, access: { kind: 'role', roleId: 'catalog-manager' } },
        { subject: COMMAND_SUBJECT, roles: ['Catalog Manager'] },
        'request-key-00000001',
        {}
      )
    ).rejects.toThrow('Access denied')
    expect(operations).toBe(0)
  })

  test('stores only the public result inside the supplied transaction and replays without business writes', async () => {
    const queries: RuntimeCommandQuery[] = []
    const saved: Record<string, unknown> = {}
    let businessReads = 0
    let transactionCalls = 0
    const database: RuntimeCommandDatabase = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.startsWith('INSERT INTO public.openpencil_command_requests')) {
          if (saved.response_json) return { rows: [], rowCount: 0 }
          saved.command_digest = values[4]
          saved.request_digest = values[5]
          return { rows: [{ request_key: values[3] }], rowCount: 1 }
        }
        if (text.startsWith('SELECT command_digest')) return { rows: [saved], rowCount: 1 }
        if (text.startsWith('UPDATE public.openpencil_command_requests')) {
          saved.response_json = values[4]
          return { rows: [], rowCount: 1 }
        }
        if (text.startsWith('SELECT ')) businessReads += 1
        return { rows: [{ id: COMMAND_ITEM, title: 'Final title' }], rowCount: 1 }
      }
    }
    const service = new loaded.service.CommandService({
      transaction: async (operation) => {
        transactionCalls += 1
        return operation(database)
      }
    })
    const principal = { subject: COMMAND_SUBJECT, roles: [] }
    const key = 'request-key-00000001'
    const body = { noteId: COMMAND_ITEM, title: 'Final title' }
    const first = await service.execute(loaded.plan, principal, key, body)
    expect(first).toEqual({ id: COMMAND_ITEM, title: 'Final title' })
    expect(JSON.parse(String(saved.response_json))).toEqual(first)
    expect(
      await service.execute(loaded.plan, principal, key, {
        title: body.title,
        noteId: body.noteId.toUpperCase()
      })
    ).toEqual(first)
    expect(businessReads).toBe(1)
    expect(transactionCalls).toBe(2)
    expect(queries[0].values.slice(0, 4)).toEqual([
      loaded.plan.applicationId,
      loaded.plan.id,
      COMMAND_SUBJECT,
      key
    ])
    await expect(
      service.execute(loaded.plan, principal, key, { ...body, title: 'Different' })
    ).rejects.toThrow('Request conflict')
    await expect(
      service.execute({ ...loaded.plan, digest: 'new-definition' }, principal, key, body)
    ).rejects.toThrow('Request conflict')
    expect(businessReads).toBe(1)
    // Definition digest is not in the unique identity, so upgrades cannot re-execute an old attempt.
    expect(
      queries
        .filter((query) => query.text.startsWith('INSERT INTO public.'))
        .every((query) =>
          query.text.includes('ON CONFLICT (application_id,command_id,subject,request_key)')
        )
    ).toBe(true)
  })

  test('a failed step does not save an idempotency result and propagates failure to transaction rollback', async () => {
    const queries: string[] = []
    let transactionFailed = false
    const database: RuntimeCommandDatabase = {
      query: async (text) => {
        queries.push(text)
        if (text.startsWith('INSERT INTO public.'))
          return { rows: [{ request_key: 'request-key-00000001' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }
    }
    const service = new loaded.service.CommandService({
      transaction: async (operation) => {
        try {
          return await operation(database)
        } catch (error) {
          transactionFailed = true
          throw error
        }
      }
    })
    await expect(
      service.execute(
        loaded.plan,
        { subject: COMMAND_SUBJECT, roles: [] },
        'request-key-00000001',
        { noteId: COMMAND_ITEM, title: 'No write' }
      )
    ).rejects.toThrow('Resource not found')
    expect(transactionFailed).toBe(true)
    expect(queries.some((text) => text.startsWith('UPDATE '))).toBe(false)
  })
})
