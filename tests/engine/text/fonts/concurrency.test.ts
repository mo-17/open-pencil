import { describe, expect, test } from 'bun:test'

import { DEFAULT_FONT_LOAD_CONCURRENCY, FontManager } from '#core/text/fonts'

function fontBytes(seed: number): ArrayBuffer {
  return Uint8Array.from([0, 1, 0, 0, seed, seed + 1, seed + 2, seed + 3]).buffer
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('Font load did not reach the expected state')
}

describe('font load concurrency', () => {
  test('uses a bounded default for new source-resolution flights', () => {
    const manager = new FontManager()
    expect(DEFAULT_FONT_LOAD_CONCURRENCY).toBe(4)
    expect(manager.loadQueueState()).toEqual({ concurrency: 4, active: 0, pending: 0 })
  })

  test('changes pending capacity without cancelling active or registered fonts', async () => {
    const manager = new FontManager({ loadConcurrency: 1 })
    const started: string[] = []
    const releases = new Map<string, () => void>()
    manager.setOnlineFontProviders({ google: false, fontsource: false })
    manager.setHostFontLoader(
      (family) =>
        new Promise<ArrayBuffer>((resolve) => {
          started.push(family)
          releases.set(family, () => resolve(fontBytes(started.length * 10)))
        })
    )

    const first = manager.loadFont('Queued Font A')
    const second = manager.loadFont('Queued Font B')
    const third = manager.loadFont('Queued Font C')
    expect(manager.loadQueueState()).toEqual({ concurrency: 1, active: 1, pending: 2 })
    await waitUntil(() => started.length === 1)
    expect(started).toEqual(['Queued Font A'])

    manager.setLoadConcurrency(2)
    await waitUntil(() => started.length === 2)
    expect(started).toEqual(['Queued Font A', 'Queued Font B'])
    expect(manager.loadQueueState()).toEqual({ concurrency: 2, active: 2, pending: 1 })

    manager.setLoadConcurrency(1)
    expect(manager.loadQueueState()).toEqual({ concurrency: 1, active: 2, pending: 1 })

    releases.get('Queued Font A')?.()
    await expect(first).resolves.toHaveProperty('byteLength', 8)
    expect(started).toEqual(['Queued Font A', 'Queued Font B'])
    expect(manager.retainedDataCount('Queued Font A')).toBe(1)

    releases.get('Queued Font B')?.()
    await expect(second).resolves.toHaveProperty('byteLength', 8)
    await waitUntil(() => started.length === 3)
    expect(started).toEqual(['Queued Font A', 'Queued Font B', 'Queued Font C'])

    releases.get('Queued Font C')?.()
    await expect(third).resolves.toHaveProperty('byteLength', 8)
    expect(manager.loadQueueState()).toEqual({ concurrency: 1, active: 0, pending: 0 })
    expect(manager.retainedDataCount('Queued Font A')).toBe(1)
    expect(manager.retainedDataCount('Queued Font B')).toBe(1)
    expect(manager.retainedDataCount('Queued Font C')).toBe(1)
  })

  test('coalesces callers for one face before consuming another queue slot', async () => {
    const manager = new FontManager({ loadConcurrency: 1 })
    let release: ((data: ArrayBuffer) => void) | undefined
    manager.setHostFontLoader(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve
        })
    )

    const first = manager.loadFont('Shared Queued Font')
    const second = manager.loadFont('Shared Queued Font')
    expect(manager.loadQueueState()).toEqual({ concurrency: 1, active: 1, pending: 0 })

    await waitUntil(() => release !== undefined)
    release?.(fontBytes(40))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(manager.loadQueueState()).toEqual({ concurrency: 1, active: 0, pending: 0 })
  })
})
