import { describe, expect, test } from 'bun:test'

import {
  createPreviewCompileScheduler,
  nextPreviewAutoDelayMs,
  normalizePreviewRefreshPolicy,
  type PreviewCompileOutcome,
  type PreviewCompileRun
} from '@/app/lowcode/preview-pane/compile-scheduler'

class FakeClock {
  nowMs = 0
  private nextTimerId = 1
  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  now = (): number => this.nowMs

  setTimer = (callback: () => void, delayMs: number): (() => void) => {
    const id = this.nextTimerId++
    this.timers.set(id, { at: this.nowMs + delayMs, callback })
    return () => this.timers.delete(id)
  }

  advance(delayMs: number): void {
    const target = this.nowMs + delayMs
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      this.timers.delete(next[0])
      this.nowMs = next[1].at
      next[1].callback()
    }
    this.nowMs = target
  }
}

interface PendingRun {
  request: PreviewCompileRun
  resolve(outcome: PreviewCompileOutcome): void
}

function deferredRunner() {
  const runs: PendingRun[] = []
  return {
    runs,
    run: (request: PreviewCompileRun) =>
      new Promise<PreviewCompileOutcome>((resolve) => {
        runs.push({ request, resolve })
      })
  }
}

async function settleScheduler(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('preview compile scheduler', () => {
  test('normalizes persisted refresh policies fail-safe to Auto', () => {
    expect(normalizePreviewRefreshPolicy('realtime')).toBe('realtime')
    expect(normalizePreviewRefreshPolicy('manual')).toBe('manual')
    expect(normalizePreviewRefreshPolicy('unknown')).toBe('auto')
    expect(normalizePreviewRefreshPolicy(null)).toBe('auto')
  })

  test('keeps one compile in flight and coalesces pending changes to the latest revision', async () => {
    const clock = new FakeClock()
    const runner = deferredRunner()
    const scheduler = createPreviewCompileScheduler({
      policy: 'realtime',
      clock,
      run: runner.run
    })

    scheduler.requestInitial()
    scheduler.requestChange()
    scheduler.requestChange(true)

    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1])
    expect(runner.runs[0].request.isCurrent()).toBe(false)
    expect(scheduler.getState()).toMatchObject({
      inFlight: true,
      pending: true,
      pendingRevision: 3,
      coalescedRequests: 1
    })

    runner.runs[0].resolve('superseded')
    await settleScheduler()

    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1, 3])
    expect(runner.runs[1].request.refreshFonts).toBe(true)
    expect(runner.runs[1].request.isCurrent()).toBe(true)

    clock.advance(420)
    runner.runs[1].resolve('pushed')
    await settleScheduler()
    expect(scheduler.getState()).toMatchObject({
      inFlight: false,
      pending: false,
      lastPushedRevision: 3,
      lastDurationMs: 420,
      autoDelayMs: 420,
      supersededRuns: 1
    })
  })

  test('Auto uses trailing debounce and adapts within the 200-1000ms bounds', async () => {
    const clock = new FakeClock()
    const runner = deferredRunner()
    const scheduler = createPreviewCompileScheduler({ policy: 'auto', clock, run: runner.run })

    scheduler.requestChange()
    clock.advance(100)
    scheduler.requestChange()
    clock.advance(199)
    expect(runner.runs).toHaveLength(0)
    clock.advance(1)
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([2])

    clock.advance(800)
    runner.runs[0].resolve('pushed')
    await settleScheduler()
    expect(scheduler.getState().autoDelayMs).toBe(800)

    scheduler.requestChange()
    clock.advance(799)
    expect(runner.runs).toHaveLength(1)
    clock.advance(1)
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([2, 3])
  })

  test('Auto trails the latest interaction while an older compile is still running', async () => {
    const clock = new FakeClock()
    const runner = deferredRunner()
    const scheduler = createPreviewCompileScheduler({ policy: 'auto', clock, run: runner.run })

    scheduler.requestInitial()
    clock.advance(50)
    scheduler.requestChange()
    clock.advance(100)
    scheduler.requestChange()
    runner.runs[0].resolve('superseded')
    await settleScheduler()

    clock.advance(199)
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1])
    clock.advance(1)
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1, 3])
  })

  test('Manual still pushes the initial preview and waits for an explicit latest flush', async () => {
    const clock = new FakeClock()
    const runner = deferredRunner()
    const scheduler = createPreviewCompileScheduler({ policy: 'manual', clock, run: runner.run })

    scheduler.requestInitial()
    scheduler.requestChange(true)
    expect(runner.runs).toHaveLength(1)
    expect(runner.runs[0].request.isCurrent()).toBe(true)

    runner.runs[0].resolve('pushed')
    await settleScheduler()
    clock.advance(10_000)
    expect(runner.runs).toHaveLength(1)
    expect(scheduler.getState()).toMatchObject({ pending: true, pendingRevision: 2 })

    scheduler.flush()
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1, 3])
    expect(runner.runs[1].request.refreshFonts).toBe(true)

    scheduler.requestChange()
    expect(runner.runs[1].request.isCurrent()).toBe(true)
    runner.runs[1].resolve('pushed')
    await settleScheduler()
    expect(scheduler.getState()).toMatchObject({ pending: true, pendingRevision: 4 })
  })

  test('switching a pending Manual change to Auto schedules its trailing flush', () => {
    const clock = new FakeClock()
    const runner = deferredRunner()
    const scheduler = createPreviewCompileScheduler({ policy: 'manual', clock, run: runner.run })

    scheduler.requestChange()
    clock.advance(500)
    expect(runner.runs).toHaveLength(0)

    scheduler.setPolicy('auto')
    expect(runner.runs.map(({ request }) => request.revision)).toEqual([1])
  })
})

describe('preview Auto delay', () => {
  test('smooths recent successful compile+ACK durations and enforces bounds', () => {
    expect(nextPreviewAutoDelayMs(null, 50)).toEqual({ delayMs: 200, recentDurationMs: 50 })
    expect(nextPreviewAutoDelayMs(null, 2_000)).toEqual({
      delayMs: 1_000,
      recentDurationMs: 2_000
    })
    expect(nextPreviewAutoDelayMs(400, 900)).toEqual({
      delayMs: 600,
      recentDurationMs: 600
    })
  })
})
