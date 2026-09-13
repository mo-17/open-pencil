import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '#compiler/adapters/react/emit/event'
import type { IRBackendRequestHandler } from '#compiler/ir/types'

import { parseExpression } from '@open-pencil/lowcode'

import { runtimeFixture, tick } from './helpers'

function expression(source: string) {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new Error('Invalid test expression')
  return parsed.ast
}
function handler(): IRBackendRequestHandler {
  return {
    kind: 'backendRequest',
    resourceId: 'notes-api',
    operation: 'create',
    payloadEntries: [{ key: 'title', ast: expression('"New"'), references: [] }],
    resultTarget: 'result',
    errorTarget: 'error',
    onSuccess: [
      {
        kind: 'backendRequest',
        resourceId: 'notes-api',
        operation: 'read',
        idAst: expression('data.id'),
        resultTarget: 'result',
        errorTarget: 'error',
        onSuccess: [
          {
            kind: 'setVariable',
            docStateName: 'title',
            ast: expression('data.title'),
            references: ['data'],
            mode: 'absolute'
          }
        ]
      }
    ]
  }
}

describe('emitted Backend action continuation', () => {
  test.each(['success', 'error'] as const)(
    'a newer query action suppresses older %s results and continuations',
    async (outcome) => {
      const fixture = await runtimeFixture()
      try {
        fixture.auth.transition('user-a')
        const action: IRBackendRequestHandler = {
          kind: 'backendRequest',
          resourceId: 'notes-api',
          operation: 'list',
          resultTarget: 'result',
          cursorTarget: 'cursor',
          errorTarget: 'error'
        }
        const event = await fixture.event(emitEventHandler([action]))
        const older = event.run()
        await tick()
        const newer = event.run()
        await tick()
        expect(fixture.pending[0].call.init.signal?.aborted).toBe(true)
        fixture.pending[1].respond({ data: [{ title: 'Newest' }], nextCursor: 'new-cursor' })
        await newer
        if (outcome === 'success')
          fixture.pending[0].respond({ data: [{ title: 'Old' }], nextCursor: 'old-cursor' })
        else fixture.pending[0].reject()
        await older
        expect(fixture.values.get('result')).toEqual([{ title: 'Newest' }])
        expect(fixture.values.get('cursor')).toBe('new-cursor')
        expect(fixture.values.has('error')).toBe(false)
      } finally {
        fixture.dispose()
      }
    }
  )

  test('nested request reads its parent result before introducing its own data binding', async () => {
    const fixture = await runtimeFixture()
    try {
      fixture.auth.transition('user-a')
      const event = await fixture.event(emitEventHandler([handler()]))
      const running = event.run()
      await tick()
      fixture.pending[0].respond({ id: 'note-id', title: 'New' })
      await tick()
      expect(fixture.pending).toHaveLength(2)
      expect(fixture.pending[1].call.url).toBe('/api/notes/note-id')
      fixture.pending[1].respond({ id: 'note-id', title: 'Read' })
      await running
      expect(fixture.values.get('result')).toEqual({ id: 'note-id', title: 'Read' })
      expect(fixture.values.get('title')).toBe('Read')
      fixture.auth.transition(null)
      expect(fixture.values.get('result')).toEqual({})
    } finally {
      fixture.dispose()
    }
  })
  test('logout while the request is pending suppresses both error targets and error continuations', async () => {
    const fixture = await runtimeFixture()
    try {
      fixture.auth.transition('user-a')
      const action = handler()
      action.onError = [
        {
          kind: 'setVariable',
          docStateName: 'title',
          ast: expression('"failed"'),
          references: [],
          mode: 'absolute'
        }
      ]
      const event = await fixture.event(emitEventHandler([action]))
      const running = event.run()
      await tick()
      fixture.auth.transition(null)
      fixture.pending[0].reject()
      await running
      expect(fixture.values.has('error')).toBe(false)
      expect(fixture.values.has('title')).toBe(false)
    } finally {
      fixture.dispose()
    }
  })
})
