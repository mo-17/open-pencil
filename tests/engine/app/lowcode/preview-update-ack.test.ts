import { describe, expect, test } from 'bun:test'

import {
  waitForPreviewUpdateAck,
  type PreviewUpdateAckEvent
} from '@/app/lowcode/preview-pane/update-ack'

function emit(
  listeners: Set<(event: PreviewUpdateAckEvent) => void>,
  event: PreviewUpdateAckEvent
): void {
  for (const listener of listeners) listener(event)
}

describe('preview update acknowledgement', () => {
  test('resolves only after the sidecar confirms the snapshot', async () => {
    const listeners = new Set<(event: PreviewUpdateAckEvent) => void>()
    const acknowledgement = waitForPreviewUpdateAck(listeners, 100)

    emit(listeners, { type: 'ready', url: 'http://localhost:5173', port: 5173 })
    expect(listeners.size).toBe(1)
    emit(listeners, { type: 'updated' })

    await expect(acknowledgement.promise).resolves.toBeUndefined()
    expect(listeners.size).toBe(0)
  })

  test('rejects and removes its listener on a sidecar protocol error', async () => {
    const listeners = new Set<(event: PreviewUpdateAckEvent) => void>()
    const acknowledgement = waitForPreviewUpdateAck(listeners, 100)

    emit(listeners, { type: 'error', message: 'invalid binary-ref' })

    await expect(acknowledgement.promise).rejects.toThrow('invalid binary-ref')
    expect(listeners.size).toBe(0)
  })

  test('times out instead of leaving the encode cache implicitly trusted', async () => {
    const listeners = new Set<(event: PreviewUpdateAckEvent) => void>()
    const acknowledgement = waitForPreviewUpdateAck(listeners, 1)

    await expect(acknowledgement.promise).rejects.toThrow('did not acknowledge update')
    expect(listeners.size).toBe(0)
  })
})
