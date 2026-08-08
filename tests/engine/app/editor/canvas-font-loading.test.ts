import { describe, expect, test } from 'bun:test'

import { effectScope, reactive } from 'vue'

import type { FontLoadProgress } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/active-store'
import {
  CanvasFontLoadingPresenter,
  type CanvasFontLoadingState,
  useCanvasFontLoading
} from '@/app/editor/fonts/canvas-font-loading'

class FakeTimers {
  #now = 0
  #nextId = 1
  readonly #tasks = new Map<number, { at: number; callback: () => void }>()

  readonly schedule = (callback: () => void, delayMs: number): (() => void) => {
    const id = this.#nextId++
    this.#tasks.set(id, { at: this.#now + delayMs, callback })
    return () => this.#tasks.delete(id)
  }

  advance(milliseconds: number): void {
    const target = this.#now + milliseconds
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      const [id, task] = next
      this.#tasks.delete(id)
      this.#now = task.at
      task.callback()
    }
    this.#now = target
  }
}

function progress(
  operationId: number,
  status: FontLoadProgress['status'],
  overrides: Partial<FontLoadProgress> = {}
): FontLoadProgress {
  return {
    operationId,
    pageId: 'page-1',
    completed: status === 'loading' ? 1 : 4,
    total: 4,
    failed: 0,
    status,
    ...overrides
  }
}

function setup() {
  const timers = new FakeTimers()
  const changes: Array<CanvasFontLoadingState | null> = []
  const presenter = new CanvasFontLoadingPresenter('page-1', (state) => changes.push(state), {
    schedule: timers.schedule
  })
  return { timers, changes, presenter }
}

describe('canvas font loading presenter', () => {
  test('never mounts or announces operations that finish inside the delay', () => {
    const { timers, changes, presenter } = setup()

    presenter.update(progress(1, 'loading'))
    timers.advance(179)
    presenter.update(progress(1, 'completed'))
    timers.advance(500)

    expect(changes).toEqual([])
  })

  test('shows live progress after the delay and holds the completed state briefly', () => {
    const { timers, changes, presenter } = setup()

    presenter.update(progress(1, 'loading'))
    timers.advance(180)
    presenter.update(progress(1, 'loading', { completed: 2 }))
    presenter.update(progress(1, 'completed', { completed: 4 }))

    expect(changes.map((state) => state?.status ?? null)).toEqual([
      'loading',
      'loading',
      'completed'
    ])
    expect(changes.at(-1)).toMatchObject({ completed: 4, total: 4, failed: 0 })

    timers.advance(299)
    expect(changes.at(-1)?.status).toBe('completed')
    timers.advance(1)
    expect(changes.at(-1)).toBeNull()
  })

  test('cancelled work hides immediately', () => {
    const { timers, changes, presenter } = setup()

    presenter.update(progress(1, 'loading'))
    timers.advance(180)
    presenter.update(progress(1, 'cancelled', { completed: 2 }))

    expect(changes.map((state) => state?.status ?? null)).toEqual(['loading', null])
  })

  test('a stale operation cannot replace a newer visible operation', () => {
    const { timers, changes, presenter } = setup()

    presenter.update(progress(1, 'loading'))
    timers.advance(180)
    presenter.update(progress(3, 'loading', { completed: 0 }))
    presenter.update(progress(2, 'loading', { completed: 2 }))
    presenter.update(progress(1, 'loading', { completed: 3 }))
    presenter.update(progress(1, 'completed'))

    expect(changes.at(-1)).toMatchObject({ operationId: 3, completed: 0, status: 'loading' })
  })

  test('switching pages clears the old page status and ignores its trailing events', () => {
    const { timers, changes, presenter } = setup()

    presenter.update(progress(1, 'loading'))
    timers.advance(180)
    presenter.setPage('page-2')
    presenter.update(progress(1, 'completed'))

    expect(changes.map((state) => state?.status ?? null)).toEqual(['loading', null])
  })

  test('dispose cancels delayed show and completed-hide callbacks', () => {
    const hidden = setup()
    hidden.presenter.update(progress(1, 'loading'))
    hidden.presenter.dispose()
    hidden.timers.advance(500)
    expect(hidden.changes).toEqual([])

    const visible = setup()
    visible.presenter.update(progress(1, 'loading'))
    visible.timers.advance(180)
    visible.presenter.update(progress(1, 'completed'))
    visible.presenter.dispose()
    visible.timers.advance(500)
    expect(visible.changes.map((state) => state?.status ?? null)).toEqual([
      'loading',
      'completed',
      null
    ])
  })

  test('the composable subscribes to editor progress and releases both listeners with its scope', () => {
    const timers = new FakeTimers()
    const listeners = new Map<string, (...args: never[]) => void>()
    const store = {
      state: reactive({ currentPageId: 'page-1' }),
      onEditorEvent: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      }
    } as EditorStore
    const scope = effectScope()
    const state = scope.run(() =>
      useCanvasFontLoading(store, {
        schedule: timers.schedule
      })
    )
    if (!state) throw new Error('font loading composable did not initialize')

    listeners.get('font:load-progress')?.(progress(1, 'loading') as never)
    timers.advance(180)
    expect(state.value).toMatchObject({ operationId: 1, status: 'loading' })

    scope.stop()
    expect(listeners.size).toBe(0)
  })
})
