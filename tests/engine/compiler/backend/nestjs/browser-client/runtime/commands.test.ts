import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '#compiler/adapters/react/emit/event'
import type { IRBackendCommandHandler } from '#compiler/ir/types'

import { parseExpression } from '@open-pencil/lowcode'

import { commandApplication } from '../command/helpers'
import { runtimeFixture, tick } from './helpers'

const input = {
  commandId: 'save-note',
  payload: { title: 'A note' },
  idempotencyKeyTarget: 'attempt'
}
function handler(): IRBackendCommandHandler {
  const parsed = parseExpression('"A note"')
  if (!parsed.ok) throw new Error('Invalid test expression')
  return {
    kind: 'backendCommand',
    commandId: 'save-note',
    payloadEntries: [{ key: 'title', ast: parsed.ast, references: [] }],
    idempotencyKeyTarget: 'attempt',
    resultTarget: 'result',
    errorTarget: 'error'
  }
}

describe('generated atomic command attempts', () => {
  test('coalesces equal payloads and retains its synchronous key through success and explicit retry', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      const first = fixture.runtime.backendCommand(input)
      const key = fixture.values.get('attempt')
      expect(key).toMatch(/^[0-9a-f-]{36}$/)
      const duplicate = fixture.runtime.backendCommand(input)
      await fixture.waitForRequest(0)
      expect(fixture.pending).toHaveLength(1)
      expect(fixture.pending[0].call.url).toBe('/api/commands/save-note')
      expect(new Headers(fixture.pending[0].call.init.headers).get('Idempotency-Key')).toBe(key)
      expect(JSON.parse(String(fixture.pending[0].call.init.body))).toEqual(input.payload)
      await expect(
        fixture.runtime.backendCommand({ ...input, payload: { title: 'Changed' } })
      ).rejects.toMatchObject({ status: 409, code: 'conflict' })
      fixture.pending[0].respond({ id: 'note-id', title: 'A note' })
      expect(await first).toEqual(await duplicate)
      expect(fixture.values.get('attempt')).toBe(key)
      const retry = fixture.runtime.backendCommand(input)
      await fixture.waitForRequest(1)
      expect(new Headers(fixture.pending[1].call.init.headers).get('Idempotency-Key')).toBe(key)
      fixture.pending[1].respond({ id: 'note-id', title: 'A note' })
      await retry
      fixture.values.set('attempt', '')
      const next = fixture.runtime.backendCommand({ ...input, payload: { title: 'New order' } })
      expect(fixture.values.get('attempt')).not.toBe(key)
      await fixture.waitForRequest(2)
      fixture.pending[2].respond({ id: 'new-id', title: 'New order' })
      await next
    } finally {
      fixture.dispose()
    }
  })

  test.each(['network', 'conflict'] as const)(
    'retains an uncertain or failed attempt after %s without automatic retries',
    async (mode) => {
      const fixture = await runtimeFixture(false, commandApplication())
      try {
        fixture.auth.transition('user-a')
        fixture.values.set('attempt', '')
        const running = fixture.runtime.backendCommand(input)
        const key = fixture.values.get('attempt')
        const rejected = running.catch((error: unknown) => error)
        await fixture.waitForRequest(0)
        if (mode === 'network') fixture.pending[0].reject()
        else fixture.pending[0].respond({ message: 'synthetic SQL secret' }, 409)
        expect(await rejected).toMatchObject({
          code: mode === 'network' ? 'request-failed' : 'conflict'
        })
        await tick()
        expect(fixture.pending).toHaveLength(1)
        expect(fixture.values.get('attempt')).toBe(key)
        const retry = fixture.runtime.backendCommand(input)
        await fixture.waitForRequest(1)
        expect(new Headers(fixture.pending[1].call.init.headers).get('Idempotency-Key')).toBe(key)
        fixture.pending[1].respond({ id: 'id', title: 'A note' })
        await retry
      } finally {
        fixture.dispose()
      }
    }
  )

  test('a hanging transport times out safely, releases UI continuation and retries the same key explicitly', async () => {
    const fixture = await runtimeFixture(false, commandApplication(), 25)
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      fixture.values.set('busy', true)
      const value = parseExpression('!1')
      if (!value.ok) throw new Error('Invalid test expression')
      const action = handler()
      action.onError = [
        {
          kind: 'setVariable',
          docStateName: 'busy',
          ast: value.ast,
          references: [],
          mode: 'absolute'
        }
      ]
      const event = await fixture.event(emitEventHandler([action]))
      const running = event.run()
      const key = fixture.values.get('attempt')
      await running
      expect(fixture.values.get('attempt')).toBe(key)
      expect(fixture.values.get('busy')).toBe(false)
      expect(fixture.values.get('error')).toBe('Backend command failed.')
      expect(fixture.pending).toHaveLength(1)
      expect(fixture.pending[0].call.init.signal?.aborted).toBe(true)
      const retry = event.run()
      await fixture.waitForRequest(1)
      expect(new Headers(fixture.pending[1].call.init.headers).get('Idempotency-Key')).toBe(key)
      fixture.pending[1].respond({ id: 'retry', title: 'A note' })
      await retry
      fixture.pending[0].respond({ id: 'late', title: 'Old' })
      await tick()
      expect(fixture.values.get('result')).toEqual({ id: 'retry', title: 'A note' })
    } finally {
      fixture.dispose()
    }
  })

  test('identity change clears attempts and results, aborts old transport, and suppresses late response branches', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      const event = await fixture.event(emitEventHandler([handler()]))
      const first = event.run()
      await fixture.waitForRequest(0)
      fixture.pending[0].respond({ id: 'first', title: 'A note' })
      await first
      expect(fixture.values.get('result')).toEqual({ id: 'first', title: 'A note' })
      const key = fixture.values.get('attempt')
      const old = event.run()
      await fixture.waitForRequest(1)
      fixture.auth.transition('user-b')
      expect(fixture.pending[1].call.init.signal?.aborted).toBe(true)
      expect(fixture.values.get('attempt')).toBe('')
      expect(fixture.values.get('result')).toEqual({})
      fixture.pending[1].respond({ id: 'old-private', title: 'Private' })
      await old
      expect(fixture.values.get('result')).toEqual({})
      const next = event.run()
      await fixture.waitForRequest(2)
      expect(fixture.values.get('attempt')).not.toBe(key)
      fixture.pending[2].respond({ id: 'new', title: 'A note' })
      await next
      expect(fixture.values.get('result')).toEqual({ id: 'new', title: 'A note' })
    } finally {
      fixture.dispose()
    }
  })

  test('nested command snapshots its parent result before declaring its own data local', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      fixture.values.set('secondAttempt', '')
      const title = parseExpression('data.title')
      if (!title.ok) throw new Error('Invalid test expression')
      const action = handler()
      action.onSuccess = [
        {
          ...handler(),
          idempotencyKeyTarget: 'secondAttempt',
          payloadEntries: [{ key: 'title', ast: title.ast, references: ['data'] }]
        }
      ]
      const event = await fixture.event(emitEventHandler([action]))
      const running = event.run()
      await fixture.waitForRequest(0)
      fixture.pending[0].respond({ id: 'first', title: 'Parent result' })
      await fixture.waitForRequest(1)
      expect(fixture.pending).toHaveLength(2)
      expect(JSON.parse(String(fixture.pending[1].call.init.body))).toEqual({
        title: 'Parent result'
      })
      fixture.pending[1].respond({ id: 'second', title: 'Nested result' })
      await running
      expect(fixture.values.get('result')).toEqual({ id: 'second', title: 'Nested result' })
      expect(fixture.values.get('secondAttempt')).not.toBe(fixture.values.get('attempt'))
    } finally {
      fixture.dispose()
    }
  })

  test('successful commands refresh affected lists once and errors expose only finite public fields', async () => {
    const fixture = await runtimeFixture(false, commandApplication())
    try {
      fixture.auth.transition('user-a')
      fixture.values.set('attempt', '')
      const rows: unknown[][] = []
      const stop = fixture.runtime.watchBackendResource(
        { resourceId: 'notes-api', operation: 'list' },
        (value) => rows.push(value)
      )
      await fixture.waitForRequest(0)
      fixture.pending[0].respond({ data: [], nextCursor: null })
      await tick()
      const event = await fixture.event(emitEventHandler([handler()]))
      const failed = event.run()
      await fixture.waitForRequest(1)
      fixture.pending[1].respond({ message: 'private db error' }, 409)
      await failed
      expect(fixture.values.get('error')).toBe('Backend command failed.')
      expect(fixture.pending).toHaveLength(2)
      const saved = event.run()
      await fixture.waitForRequest(2)
      fixture.pending[2].respond({ id: 'new', title: 'A note' })
      await saved
      await fixture.waitForRequest(3)
      expect(fixture.pending).toHaveLength(4)
      expect(fixture.pending[3].call.url).toBe('/api/notes')
      stop()
    } finally {
      fixture.dispose()
    }
  })
})
