import { describe, expect, test } from 'bun:test'

import { OTHER_SUBJECT, RECORD, SUBJECT, authorizationRuntime } from './helpers'

describe('generated NestJS public, role and owner service queries', () => {
  test('public reads project only declared fields while every anonymous mutation is rejected', async () => {
    const runtime = await authorizationRuntime('catalog')
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const service = runtime.service({
      async query(sql, values) {
        calls.push({ sql, values })
        return { rows: [{ id: RECORD, title: 'Catalog' }] }
      }
    })
    try {
      expect(await service.read(null, RECORD)).toEqual({ id: RECORD, title: 'Catalog' })
      expect(calls[0]?.sql).toContain('WHERE (TRUE)')
      expect(calls[0]?.sql.split(' FROM ')[0]).not.toContain('owner_id')
      for (const promise of [
        service.create(null, { title: 'x' }),
        service.update(null, RECORD, { title: 'x' }),
        service.delete(null, RECORD)
      ])
        await expect(promise).rejects.toThrow('Authentication required.')
      expect(calls).toHaveLength(1)
      await expect(service.create({ subject: SUBJECT, roles: [] }, { title: 'x' })).rejects.toThrow(
        'Operation is not permitted.'
      )
    } finally {
      runtime.dispose()
    }
  })

  test('owner writes stay scoped and role writes can manage catalog without changing the owner', async () => {
    const runtime = await authorizationRuntime('mixed')
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const service = runtime.service({
      async query(sql, values) {
        calls.push({ sql, values })
        return { rows: [] }
      }
    })
    try {
      await expect(
        service.update({ subject: SUBJECT, roles: [] }, RECORD, { title: 'x' })
      ).rejects.toThrow('Record not found')
      expect(calls[0]?.sql).toContain('WHERE ("owner_id" = $1)')
      expect(calls[0]?.values).toEqual([SUBJECT, RECORD, 'x'])
      await expect(
        service.update({ subject: OTHER_SUBJECT, roles: ['catalog-admin'] }, RECORD, {
          title: 'y',
          owner_id: SUBJECT
        })
      ).rejects.toThrow('Record not found')
      expect(calls[1]?.sql).toContain('WHERE (TRUE)')
      expect(calls[1]?.sql).not.toContain('"owner_id" =')
      expect(calls[1]?.values).toEqual([RECORD, 'y'])
    } finally {
      runtime.dispose()
    }
  })

  test('role-created records always receive the verified subject and owner reads hide other records', async () => {
    const runtime = await authorizationRuntime('mixed')
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const service = runtime.service({
      async query(sql, values) {
        calls.push({ sql, values })
        return { rows: [] }
      }
    })
    try {
      await service.create(
        { subject: SUBJECT, roles: ['catalog-admin'] },
        { title: 'x', owner_id: OTHER_SUBJECT }
      )
      expect(calls[0]?.values).toEqual([SUBJECT, 'x'])
      await expect(service.read({ subject: SUBJECT, roles: [] }, RECORD)).rejects.toThrow(
        'Record not found'
      )
      expect(calls[1]?.sql).toContain('WHERE ("owner_id" = $1)')
      expect(calls[1]?.values).toEqual([SUBJECT, RECORD])
    } finally {
      runtime.dispose()
    }
  })
})
