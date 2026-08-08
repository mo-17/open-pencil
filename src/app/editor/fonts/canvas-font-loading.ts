import { tryOnScopeDispose } from '@vueuse/core'
import { readonly, shallowRef, type DeepReadonly, type ShallowRef } from 'vue'

import type { FontLoadProgress } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/active-store'

const DEFAULT_SHOW_DELAY_MS = 180
const DEFAULT_COMPLETION_HOLD_MS = 300

export interface CanvasFontLoadingPresenterOptions {
  readonly showDelayMs?: number
  readonly completionHoldMs?: number
  readonly schedule?: (callback: () => void, delayMs: number) => () => void
}

export type CanvasFontLoadingState = Readonly<FontLoadProgress>

/**
 * Turns noisy font-load events into a stable, delayed canvas status.
 *
 * Fast operations never become visible. Once visible, a completed operation stays around long
 * enough to be perceived. The editor's monotonic operation IDs form a high-water mark so a late
 * worker event cannot replace the status of newer work.
 */
export class CanvasFontLoadingPresenter {
  readonly #showDelayMs: number
  readonly #completionHoldMs: number
  readonly #schedule: NonNullable<CanvasFontLoadingPresenterOptions['schedule']>
  readonly #onChange: (state: CanvasFontLoadingState | null) => void

  #pageId: string
  #active: CanvasFontLoadingState | null = null
  #lastRetiredOperationId = 0
  #visible = false
  #cancelShow: (() => void) | null = null
  #cancelHide: (() => void) | null = null

  constructor(
    pageId: string,
    onChange: (state: CanvasFontLoadingState | null) => void,
    options: CanvasFontLoadingPresenterOptions = {}
  ) {
    this.#pageId = pageId
    this.#onChange = onChange
    this.#showDelayMs = Math.max(0, options.showDelayMs ?? DEFAULT_SHOW_DELAY_MS)
    this.#completionHoldMs = Math.max(0, options.completionHoldMs ?? DEFAULT_COMPLETION_HOLD_MS)
    this.#schedule =
      options.schedule ??
      ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        return () => clearTimeout(timer)
      })
  }

  update(progress: FontLoadProgress): void {
    if (
      progress.pageId !== this.#pageId ||
      progress.operationId <= this.#lastRetiredOperationId ||
      (this.#active !== null && progress.operationId < this.#active.operationId)
    )
      return

    if (progress.status === 'loading') {
      this.#updateLoading(progress)
      return
    }

    if (progress.operationId !== this.#active?.operationId) return
    if (progress.status === 'cancelled') {
      this.#finishActive(this.#visible)
      return
    }

    if (this.#active.status !== 'loading') return
    this.#active = progress
    this.#cancelShowTimer()
    if (!this.#visible) {
      this.#retire(progress.operationId)
      this.#active = null
      return
    }

    this.#onChange(progress)
    this.#cancelHide = this.#schedule(() => this.#finishActive(true), this.#completionHoldMs)
  }

  setPage(pageId: string): void {
    if (pageId === this.#pageId) return
    this.#pageId = pageId
    this.#finishActive(this.#visible)
  }

  reset(): void {
    this.#finishActive(this.#visible)
  }

  dispose(): void {
    this.#finishActive(this.#visible)
  }

  #updateLoading(progress: FontLoadProgress): void {
    if (this.#active && progress.operationId !== this.#active.operationId) {
      const keepVisible = this.#visible
      this.#finishActive(false)
      this.#active = progress
      this.#visible = keepVisible
      if (keepVisible) {
        this.#onChange(progress)
        return
      }
      this.#scheduleShow()
      return
    }

    if (!this.#active) {
      this.#active = progress
      this.#scheduleShow()
      return
    }

    if (this.#active.status !== 'loading') return
    this.#active = progress
    if (this.#visible) this.#onChange(progress)
  }

  #scheduleShow(): void {
    this.#cancelShowTimer()
    this.#cancelShow = this.#schedule(() => {
      this.#cancelShow = null
      if (this.#active?.status !== 'loading') return
      this.#visible = true
      this.#onChange(this.#active)
    }, this.#showDelayMs)
  }

  #finishActive(notifyHidden: boolean): void {
    this.#cancelShowTimer()
    this.#cancelHideTimer()
    if (this.#active) this.#retire(this.#active.operationId)
    this.#active = null
    this.#visible = false
    if (notifyHidden) this.#onChange(null)
  }

  #cancelShowTimer(): void {
    this.#cancelShow?.()
    this.#cancelShow = null
  }

  #cancelHideTimer(): void {
    this.#cancelHide?.()
    this.#cancelHide = null
  }

  #retire(operationId: number): void {
    this.#lastRetiredOperationId = Math.max(this.#lastRetiredOperationId, operationId)
  }
}

export function useCanvasFontLoading(
  store: EditorStore,
  presenterOptions: CanvasFontLoadingPresenterOptions = {}
): DeepReadonly<ShallowRef<CanvasFontLoadingState | null>> {
  const state = shallowRef<CanvasFontLoadingState | null>(null)
  const presenter = new CanvasFontLoadingPresenter(
    store.state.currentPageId,
    (next) => (state.value = next),
    presenterOptions
  )
  const stopProgress = store.onEditorEvent('font:load-progress', (progress) =>
    presenter.update(progress)
  )
  const stopPage = store.onEditorEvent('page:changed', (pageId) => presenter.setPage(pageId))
  const stopGraph = store.onEditorEvent('graph:replaced', () => presenter.reset())

  tryOnScopeDispose(() => {
    stopProgress()
    stopPage()
    stopGraph()
    presenter.dispose()
  })

  return readonly(state)
}
