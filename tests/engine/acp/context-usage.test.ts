import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { effectScope } from 'vue'

import {
  ACP_USAGE_MAX_AGE_MS,
  acpContextUsageView,
  useACPContextUsage
} from '@/app/ai/acp/context-usage'
import {
  beginACPDiagnostics,
  getACPDiagnostics,
  recordACPConfigOptions,
  recordACPNewSession,
  recordACPPrompt,
  recordACPSessionUpdate,
  resetACPDiagnostics
} from '@/app/ai/acp/diagnostics'
import { createPendingACPUsage } from '@/app/ai/acp/pending-usage'

beforeEach(() => resetACPDiagnostics())

function session(id = 'first'): number {
  const owner = beginACPDiagnostics('Agent')
  recordACPNewSession({ sessionId: id }, owner)
  return owner
}

function report(owner: number, used = 20, size = 100): void {
  recordACPSessionUpdate({ sessionUpdate: 'usage_update', used, size }, owner)
}

function view(id = 'first', now = Date.now()) {
  return acpContextUsageView(getACPDiagnostics(), id, now)
}

describe('ACP context presentation', () => {
  test('a newly arrived report is immediately available between clock ticks', () => {
    const owner = session()
    const scope = effectScope()
    const current = scope.run(() => useACPContextUsage(() => 'first'))
    expect(current?.value.state).toBe('unavailable')
    const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 100)
    try {
      report(owner)
      expect(current?.value.state).toBe('available')
    } finally {
      clock.mockRestore()
      scope.stop()
    }
  })

  test('an explicit model selection invalidates usage from an unknown model', () => {
    const owner = session()
    report(owner)
    recordACPConfigOptions(
      [
        {
          type: 'select',
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'selected',
          options: []
        }
      ],
      owner
    )
    expect(view()).toEqual({ state: 'unavailable' })
  })

  test('early reports remain bounded, retain arrival time and require accepted session identity', () => {
    const pending = createPendingACPUsage()
    const update = { sessionUpdate: 'usage_update' as const, used: 10, size: 100 }
    pending.record('first', update, 123)
    pending.record('first', { ...update, used: 20 }, 124)
    expect(pending.take('first')).toEqual({
      sessionId: 'first',
      update: { ...update, used: 20 },
      receivedAt: 124
    })
    expect(pending.take('first')).toBeNull()
    pending.record('foreign', update)
    expect(pending.take('first')).toBeNull()
    pending.record('first', update)
    pending.clear()
    expect(pending.take('first')).toBeNull()
  })

  test('distinguishes absent reports from a valid zero and expires old reports', () => {
    const owner = session()
    expect(view()).toEqual({ state: 'unavailable' })
    report(owner, 0)
    expect(view()).toMatchObject({ state: 'available', used: 0, capacity: 100, percent: 0 })
    expect(view('first', Date.now() + ACP_USAGE_MAX_AGE_MS)).toEqual({ state: 'stale' })
  })

  test.each([
    [Number.NaN, 100],
    [-1, 100],
    [1, 0],
    [101, 100],
    [0.5, 100],
    [1, Infinity]
  ])('rejects invalid usage %p / %p instead of showing zero', (used, size) => {
    const owner = session()
    report(owner)
    report(owner, used, size)
    expect(view()).toEqual({ state: 'invalid' })
  })

  test('does not expose another session or late reports from the previous agent', () => {
    const old = session()
    report(old)
    expect(view('second')).toEqual({ state: 'unavailable' })
    const current = session('second')
    report(old, 99)
    recordACPNewSession({ sessionId: 'first' }, old)
    resetACPDiagnostics(old)
    expect(view('second')).toEqual({ state: 'unavailable' })
    report(current, 40)
    expect(view('second')).toMatchObject({ state: 'available', used: 40 })
    resetACPDiagnostics(current)
    report(current, 90)
    expect(view('second')).toEqual({ state: 'unavailable' })
  })

  test('invalidates usage when the agent reports a model change', () => {
    const owner = session()
    const options = (model: string) => [
      {
        type: 'select' as const,
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: model,
        options: []
      }
    ]
    recordACPConfigOptions(options('one'), owner)
    report(owner)
    recordACPPrompt(
      { stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } },
      owner
    )
    expect(view()).toMatchObject({ state: 'available', inputTokens: 8, outputTokens: 3 })
    recordACPConfigOptions(options('two'), owner)
    expect(view()).toEqual({ state: 'unavailable' })
  })

  test('keeps token reports independent and clears missing or invalid latest usage', () => {
    const owner = session()
    recordACPPrompt(
      { stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } },
      owner
    )
    expect(view()).toEqual({ state: 'unavailable', inputTokens: 8, outputTokens: 3 })
    report(owner)
    recordACPPrompt({ stopReason: 'end_turn' }, owner)
    expect(view()).toMatchObject({ state: 'available', used: 20 })
    expect(view().inputTokens).toBeUndefined()
    recordACPPrompt(
      { stopReason: 'end_turn', usage: { inputTokens: -1, outputTokens: 3, totalTokens: 11 } },
      owner
    )
    expect(view().inputTokens).toBeUndefined()
  })
})
