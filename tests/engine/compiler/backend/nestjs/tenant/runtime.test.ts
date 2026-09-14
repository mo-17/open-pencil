import { describe, expect, test } from 'bun:test'

import { authorizationRuntime, OTHER_SUBJECT, SUBJECT, RECORD } from '../authorization/helpers'
import {
  commandRuntime,
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  type RuntimeCommandQuery
} from '../commands/helpers'
import { tenantApplication, STORE, OTHER_STORE } from './helpers'

describe('generated NestJS tenant enforcement', () => {
  test('tenant CRUD binds the caller and selected store, preserving owner OR tenant reads', async () => {
    const runtime = await authorizationRuntime('owner', tenantApplication())
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const service = runtime.service({
      async query(sql, values) {
        calls.push({ sql, values })
        return { rows: [] }
      }
    })
    try {
      await expect(service.read({ subject: SUBJECT, roles: ['merchant'] }, RECORD)).rejects.toThrow(
        'Record not found'
      )
      expect(calls[0].sql).toContain('"owner_id" = $1 OR EXISTS (SELECT 1 FROM "public"."stores"')
      expect(calls[0].sql).toContain('"__openpencil_member"."id" = "notes"."store_id"')
      expect(calls[0].values).toEqual([SUBJECT, SUBJECT, RECORD])
      await expect(
        service.create(
          { subject: SUBJECT, roles: ['merchant'] },
          { title: 'x', store_id: OTHER_STORE }
        )
      ).rejects.toThrow('Operation is not permitted')
      expect(calls[1].sql).toContain('SELECT $1, $2, $3 WHERE (EXISTS')
      expect(calls[1].sql).toContain('FOR SHARE')
      expect(calls[1].values).toEqual([SUBJECT, 'x', OTHER_STORE, OTHER_STORE, SUBJECT])
      await expect(
        service.update({ subject: SUBJECT, roles: ['merchant'] }, RECORD, {
          title: 'x',
          store_id: OTHER_STORE,
          owner_id: OTHER_SUBJECT
        })
      ).rejects.toThrow('Record not found')
      expect(calls[2].sql).toContain('EXISTS (SELECT 1 FROM "public"."stores"')
      expect(calls[2].sql).toContain('SET "title" =')
      expect(calls[2].sql).not.toContain('SET "store_id"')
      expect(calls[2].values).not.toContain(OTHER_STORE)
    } finally {
      runtime.dispose()
    }
  })

  test('a tenant-only list without the merchant role returns no rows; invalid selectors never reach SQL', async () => {
    const app = tenantApplication()
    if (!app.httpApi) throw new Error('Missing API')
    app.httpApi.resources[0].readPolicyIds = ['merchant-notes']
    const runtime = await authorizationRuntime('owner', app)
    const calls: string[] = []
    const service = runtime.service({
      async query(sql) {
        calls.push(sql)
        return { rows: [] }
      }
    })
    const query = { limit: 25, filter: [], direction: 'asc', context: '' }
    try {
      expect(await service.list({ subject: SUBJECT, roles: [] }, query)).toEqual({
        data: [],
        nextCursor: null
      })
      expect(calls[0]).toContain('WHERE (FALSE)')
      await expect(service.list(null, { limit: 25 })).rejects.toThrow('Authentication required')
      await expect(
        service.create(
          { subject: SUBJECT, roles: ['merchant'] },
          { title: 'x', store_id: "' OR TRUE --" }
        )
      ).rejects.toThrow('Operation is not permitted')
      await expect(
        service.create({ subject: SUBJECT, roles: [] }, { title: 'x', store_id: STORE })
      ).rejects.toThrow('Operation is not permitted')
      expect(calls).toHaveLength(1)
    } finally {
      runtime.dispose()
    }
  })

  test('locks current membership before ledger access, including replay, and rejects revoked or foreign membership', async () => {
    const runtime = await commandRuntime(tenantApplication())
    const calls: RuntimeCommandQuery[] = []
    const saved: Record<string, unknown> = {}
    let membership = true
    const service = new runtime.service.CommandService({
      transaction: async (operation) =>
        operation({
          async query(text, values = []) {
            calls.push({ text, values })
            if (text.includes('FROM "public"."stores"'))
              return { rowCount: membership ? 1 : 0, rows: membership ? [{ id: STORE }] : [] }
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
            return { rowCount: 1, rows: [{ id: COMMAND_ITEM, title: 'Updated' }] }
          }
        })
    })
    const principal = { subject: COMMAND_SUBJECT, roles: ['merchant'] }
    const body = { noteId: COMMAND_ITEM, storeId: STORE, title: 'Updated' }
    try {
      const result = await service.execute(runtime.plan, principal, 'tenant-request-0001', body)
      expect(calls[0].text).toContain('"owner_id" = $1 AND "id" = $2 FOR SHARE')
      expect(calls[0].values).toEqual([COMMAND_SUBJECT, STORE])
      expect(calls[1].text).toStartWith('INSERT INTO public.openpencil_command_requests')
      const businessRead = calls.find((query) => query.text.includes('FROM "public"."notes"'))
      expect(businessRead?.text).toContain('"id" = $1 AND "store_id" = $2 FOR UPDATE')
      expect(businessRead?.values).toEqual([COMMAND_ITEM, STORE])
      calls.length = 0
      expect(await service.execute(runtime.plan, principal, 'tenant-request-0001', body)).toEqual(
        result
      )
      expect(calls[0].text).toContain('FROM "public"."stores"')
      expect(calls.some((query) => query.text.includes('FROM "public"."notes"'))).toBe(false)
      membership = false
      calls.length = 0
      await expect(
        service.execute(runtime.plan, principal, 'tenant-request-0001', body)
      ).rejects.toThrow('Access denied')
      expect(calls).toHaveLength(1)
      await expect(
        service.execute(runtime.plan, principal, 'tenant-request-0002', {
          ...body,
          storeId: OTHER_STORE
        })
      ).rejects.toThrow('Access denied')
      expect(calls[1].values).toEqual([COMMAND_SUBJECT, OTHER_STORE])
      calls.length = 0
      await expect(
        service.execute(runtime.plan, { ...principal, roles: [] }, 'tenant-request-0001', body)
      ).rejects.toThrow('Access denied')
      expect(calls).toHaveLength(0)
    } finally {
      await runtime.dispose()
    }
  })

  test('a record in a different store fails the locked read before any business mutation', async () => {
    const runtime = await commandRuntime(tenantApplication())
    const calls: RuntimeCommandQuery[] = []
    try {
      await expect(
        runtime.execution.executeCommand(
          {
            async query(text, values = []) {
              calls.push({ text, values })
              return { rowCount: 0, rows: [] }
            }
          },
          runtime.plan,
          { noteId: COMMAND_ITEM, storeId: OTHER_STORE, title: 'Forbidden' },
          COMMAND_SUBJECT
        )
      ).rejects.toThrow('Resource not found')
      expect(calls).toHaveLength(1)
      expect(calls[0].text).toContain('"store_id" = $2 FOR UPDATE')
      expect(calls[0].values).toEqual([COMMAND_ITEM, OTHER_STORE])
    } finally {
      await runtime.dispose()
    }
  })
})
