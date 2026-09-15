import { expect, test } from 'bun:test'

import { runtimeFixture, tick } from './helpers'

test('invalid document filter values fail through the list error boundary without sending a broader query', async () => {
  const fixture = await runtimeFixture()
  const invalid = [{}, [], undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n]
  try {
    fixture.auth.transition('user-a')
    for (const value of invalid) {
      const rows: unknown[][] = []
      const errors: string[] = []
      const stop = fixture.runtime.watchBackendResource(
        { resourceId: 'notes-api', operation: 'list', filter: { title: value } },
        (next) => rows.push(next),
        undefined,
        (error) => errors.push(error)
      )
      try {
        await tick()
        expect(fixture.pending).toHaveLength(0)
        expect(rows).toEqual([[]])
        expect(errors).toEqual(['', 'Backend request failed.'])
      } finally {
        stop()
      }
    }
  } finally {
    fixture.dispose()
  }
})

test('scalar filters preserve exact values and action failures never invoke transport', async () => {
  const fixture = await runtimeFixture()
  try {
    fixture.auth.transition('user-a')
    const filter = { text: "O'Reilly %_", zero: 0, disabled: false, empty: '', absent: null }
    const pending = fixture.runtime.backendRequest({
      resourceId: 'notes-api',
      operation: 'list',
      filter
    })
    await tick()
    const request = fixture.pending[0]
    expect(request).toBeDefined()
    const url = new URL(request.call.url, 'https://preview.example.test')
    expect(JSON.parse(url.searchParams.get('filter') ?? '')).toEqual(filter)
    request.respond({ data: [], nextCursor: null })
    await pending
    const invalid = fixture.runtime.backendRequest({
      resourceId: 'notes-api',
      operation: 'list',
      filter: { title: { nested: 'value' } }
    })
    const rejection = expect(invalid).rejects.toThrow('Backend request failed.')
    await tick()
    fixture.pending[1]?.respond({ data: [], nextCursor: null })
    await rejection
    expect(fixture.pending).toHaveLength(1)
  } finally {
    fixture.dispose()
  }
})
