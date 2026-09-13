import { expect, test } from 'bun:test'

import { emitEventHandler } from '#compiler/adapters/react/emit/event'

import { runtimeFixture, tick } from './helpers'

test('defensively omits an empty filter from the emitted action request', async () => {
  const fixture = await runtimeFixture()
  try {
    fixture.auth.transition('user-a')
    const event = await fixture.event(
      emitEventHandler([
        {
          kind: 'backendRequest',
          resourceId: 'notes-api',
          operation: 'list',
          filterEntries: []
        }
      ])
    )
    const running = event.run()
    await tick()
    expect(fixture.pending).toHaveLength(1)
    expect(fixture.pending[0].call.url).toBe('/api/notes')
    fixture.pending[0].respond({ data: [], nextCursor: null })
    await running
  } finally {
    fixture.dispose()
  }
})
