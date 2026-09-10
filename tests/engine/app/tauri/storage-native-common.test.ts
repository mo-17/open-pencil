import { describe, expect, test } from 'bun:test'

import { boundedStorageRequestBody } from '@/app/tauri/storage-native-common'

describe('shared storage native request bodies', () => {
  test('cancels a stalled body reader and rejects promptly when the request aborts', async () => {
    const reason = new Error('request body cancelled')
    const cancelled: unknown[] = []
    const body = new ReadableStream<Uint8Array>({
      pull: () =>
        new Promise<void>((resolve) => {
          void resolve
        }),
      cancel(cancelReason) {
        cancelled.push(cancelReason)
        return Promise.reject(new Error('expected ignored cancellation failure'))
      }
    })
    const controller = new AbortController()
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body,
      duplex: 'half',
      signal: controller.signal
    }
    const request = new Request('https://storage.invalid/upload', init)

    const pending = boundedStorageRequestBody(request, 1_024, () => new Error('too large'))
    controller.abort(reason)

    const outcome = await Promise.race([
      pending.then(
        () => ({ state: 'resolved' as const }),
        (error: unknown) => ({ state: 'rejected' as const, error })
      ),
      new Promise<{ state: 'timed-out' }>((resolve) => {
        setTimeout(() => resolve({ state: 'timed-out' }), 100)
      })
    ])

    expect(outcome).toEqual({ state: 'rejected', error: reason })
    expect(cancelled).toEqual([reason])
  })
})
