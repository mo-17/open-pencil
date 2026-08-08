import { describe, expect, test } from 'bun:test'

import { DynamicConcurrencyLimiter, abortError } from '#core/async-work'

describe('DynamicConcurrencyLimiter', () => {
  test('raises queued capacity and lowers it without interrupting active tasks', async () => {
    const limiter = new DynamicConcurrencyLimiter(1)
    const started: number[] = []
    const releases = new Map<number, () => void>()
    const run = (id: number) =>
      limiter.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(id)
            releases.set(id, () => resolve(id))
          })
      )

    const first = run(1)
    const second = run(2)
    const third = run(3)
    expect(started).toEqual([1])
    expect(limiter.state()).toEqual({ concurrency: 1, active: 1, pending: 2 })

    limiter.setConcurrency(2)
    expect(started).toEqual([1, 2])
    expect(limiter.state()).toEqual({ concurrency: 2, active: 2, pending: 1 })

    limiter.setConcurrency(1)
    expect(limiter.state()).toEqual({ concurrency: 1, active: 2, pending: 1 })

    releases.get(1)?.()
    await expect(first).resolves.toBe(1)
    expect(started).toEqual([1, 2])
    expect(limiter.state()).toEqual({ concurrency: 1, active: 1, pending: 1 })

    releases.get(2)?.()
    await expect(second).resolves.toBe(2)
    expect(started).toEqual([1, 2, 3])
    expect(limiter.state()).toEqual({ concurrency: 1, active: 1, pending: 0 })

    releases.get(3)?.()
    await expect(third).resolves.toBe(3)
    expect(limiter.state()).toEqual({ concurrency: 1, active: 0, pending: 0 })
  })

  test('releases capacity after a synchronous task failure', async () => {
    const limiter = new DynamicConcurrencyLimiter(1)
    const failed = limiter.run(() => {
      throw new Error('synthetic failure')
    })
    const surviving = limiter.run(() => 'finished')

    await expect(failed).rejects.toThrow('synthetic failure')
    await expect(surviving).resolves.toBe('finished')
    expect(limiter.state()).toEqual({ concurrency: 1, active: 0, pending: 0 })
  })

  test('releases capacity after an active task aborts', async () => {
    const limiter = new DynamicConcurrencyLimiter(1)
    let rejectActive: ((reason: Error) => void) | undefined
    const active = limiter.run(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectActive = reject
        })
    )
    const queued = limiter.run(() => 'continued')
    expect(limiter.state()).toEqual({ concurrency: 1, active: 1, pending: 1 })

    rejectActive?.(abortError('cancel active work'))
    await expect(active).rejects.toMatchObject({ name: 'AbortError' })
    await expect(queued).resolves.toBe('continued')
    expect(limiter.state()).toEqual({ concurrency: 1, active: 0, pending: 0 })
  })

  test('rejects unusable capacity values', () => {
    expect(() => new DynamicConcurrencyLimiter(0)).toThrow(RangeError)
    const limiter = new DynamicConcurrencyLimiter(1)
    expect(() => limiter.setConcurrency(Number.NaN)).toThrow(RangeError)
  })
})
