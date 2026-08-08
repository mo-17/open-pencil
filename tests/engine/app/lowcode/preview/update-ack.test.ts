import { describe, expect, test } from 'bun:test'

import {
  createPreviewStartupEventBuffer,
  waitForPreviewUpdateAck,
  type PreviewUpdateAckEvent
} from '@/app/lowcode/preview-pane/update-ack'

describe('preview startup event buffer', () => {
  test('replays an early ready event exactly while startup is pending', () => {
    const buffer = createPreviewStartupEventBuffer()
    const events: PreviewUpdateAckEvent[] = []
    buffer.capture({ type: 'ready', url: 'http://localhost:1234/', port: 1234 })
    buffer.replay((event) => events.push(event))
    buffer.settle()
    buffer.replay((event) => events.push(event))
    expect(events).toEqual([{ type: 'ready', url: 'http://localhost:1234/', port: 1234 }])
  })

  test('preserves the first startup result and ignores update acknowledgements', () => {
    const buffer = createPreviewStartupEventBuffer()
    const events: PreviewUpdateAckEvent[] = []
    buffer.capture({ type: 'updated' })
    buffer.capture({ type: 'error', message: 'early failure' })
    buffer.capture({ type: 'ready', url: 'http://localhost:9999/', port: 9999 })
    buffer.replay((event) => events.push(event))
    expect(events).toEqual([{ type: 'error', message: 'early failure' }])
  })
})

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
