import type { Editor } from '@open-pencil/core/editor'
import {
  validateGeneratedEffectSpec,
  type GeneratedEffectPreset,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { CanvasRenderLayer } from './types'

type RenderLoopOptions = {
  layer?: CanvasRenderLayer
}

const MAX_CONSECUTIVE_RENDER_RETRIES = 2
const SMOOTH_GENERATED_EFFECT_FPS = 30
const MAX_GENERATED_EFFECT_FPS = 30

type GeneratedEffectSchedule = {
  active: boolean
  cadenceHz: number
}

function generatedEffectCadenceHz(preset: GeneratedEffectPreset, frequencyHz: number): number {
  if (preset !== 'noise') return SMOOTH_GENERATED_EFFECT_FPS
  return Math.min(MAX_GENERATED_EFFECT_FPS, Math.max(1, frequencyHz))
}

function animatedGeneratedEffectSchedule(
  graph: SceneGraph,
  pageId: string,
  prefersReducedMotion: boolean
): GeneratedEffectSchedule {
  if (prefersReducedMotion) return { active: false, cadenceHz: 0 }
  const page = graph.getNode(pageId)
  if (!page) return { active: false, cadenceHz: 0 }
  const pending: SceneNode[] = [page]
  let cadenceHz = 0
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || !node.visible || node.internalOnly || node.isMask || node.opacity <= 0) continue
    for (let index = node.childIds.length - 1; index >= 0; index--) {
      const child = graph.getNode(node.childIds[index])
      if (child) pending.push(child)
    }
    if (!node.generatedEffect || !(node.width > 0 && node.height > 0)) continue
    const result = validateGeneratedEffectSpec(node.generatedEffect)
    if (!result.success || result.value.opacity <= 0) continue
    const { time } = result.value.uniforms
    if (time.scale <= 0 || time.frequencyHz <= 0) continue
    cadenceHz = Math.max(
      cadenceHz,
      generatedEffectCadenceHz(result.value.params.preset, time.frequencyHz * time.scale)
    )
  }
  return { active: cadenceHz > 0, cadenceHz }
}

type EditorRenderScheduler = {
  schedule: (callback: FrameRequestCallback) => void
  cancel: (callback: FrameRequestCallback) => void
}

const renderSchedulers = new WeakMap<Editor, EditorRenderScheduler>()

function getRenderScheduler(editor: Editor): EditorRenderScheduler {
  const existing = renderSchedulers.get(editor)
  if (existing) return existing

  let frameId: number | null = null
  const callbacks = new Set<FrameRequestCallback>()

  function flush(timestampMs: number) {
    frameId = null
    const pending = [...callbacks]
    callbacks.clear()
    for (const callback of pending) {
      try {
        callback(timestampMs)
      } catch (error) {
        // One failed surface must not strand the other shared surface in a
        // permanently scheduled state.
        console.error('Canvas frame callback failed', error)
      }
    }
  }

  const scheduler = {
    schedule(callback: FrameRequestCallback) {
      callbacks.add(callback)
      if (frameId !== null) return
      frameId = requestAnimationFrame(flush)
    },
    cancel(callback: FrameRequestCallback) {
      callbacks.delete(callback)
      if (callbacks.size === 0 && frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
    }
  }

  renderSchedulers.set(editor, scheduler)
  return scheduler
}

function shouldScheduleForSelection(layer: CanvasRenderLayer | undefined) {
  return layer !== 'scene'
}

function shouldDriveMotion(layer: CanvasRenderLayer | undefined) {
  return layer !== 'overlays'
}

export function createCanvasRenderLoop(
  editor: Editor,
  renderNow: () => unknown,
  options: RenderLoopOptions = {}
) {
  const scheduler = getRenderScheduler(editor)
  const drivesMotion = shouldDriveMotion(options.layer)
  const reducedMotionQuery =
    drivesMotion && typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  let prefersReducedMotion = reducedMotionQuery?.matches ?? false
  let dirty = true
  let frameScheduled = false
  let lastRenderVersion = -1
  let lastSelectedIds: Set<string> | null = null
  let generatedEffectTimer: ReturnType<typeof setTimeout> | null = null
  let generatedEffectFrameDue = false
  let generatedEffectCacheKey = ''
  let generatedEffectSchedule: GeneratedEffectSchedule = { active: false, cadenceHz: 0 }
  let consecutiveRenderFailures = 0
  const runtimeDocument: Document | undefined =
    typeof document === 'undefined' ? undefined : document
  let pageVisible = runtimeDocument?.visibilityState !== 'hidden'
  let suspended = false
  let disposed = false

  function currentGeneratedEffectSchedule(): GeneratedEffectSchedule {
    if (!drivesMotion) return { active: false, cadenceHz: 0 }
    const cacheKey = `${editor.state.currentPageId}:${editor.state.sceneVersion}:${prefersReducedMotion}`
    if (cacheKey !== generatedEffectCacheKey) {
      generatedEffectCacheKey = cacheKey
      generatedEffectSchedule = animatedGeneratedEffectSchedule(
        editor.graph,
        editor.state.currentPageId,
        prefersReducedMotion
      )
    }
    return generatedEffectSchedule
  }

  function clearGeneratedEffectTimer() {
    if (generatedEffectTimer !== null) clearTimeout(generatedEffectTimer)
    generatedEffectTimer = null
    generatedEffectFrameDue = false
  }

  function scheduleGeneratedEffectFrame(cadenceHz: number) {
    if (generatedEffectTimer !== null || cadenceHz <= 0 || suspended || disposed || !pageVisible) {
      return
    }
    generatedEffectTimer = setTimeout(() => {
      generatedEffectTimer = null
      if (suspended || disposed || !pageVisible) return
      generatedEffectFrameDue = true
      scheduleFrame()
    }, 1000 / cadenceHz)
  }

  function renderCurrentFrame(): boolean {
    const versionChanged = editor.state.renderVersion !== lastRenderVersion
    const selectionChanged = editor.state.selectedIds !== lastSelectedIds
    if (!dirty && !versionChanged && !selectionChanged) return true

    dirty = false
    let renderSucceeded = true
    try {
      renderSucceeded = renderNow() !== false
    } catch (error) {
      renderSucceeded = false
      console.error('Canvas render failed', error)
    }
    if (!renderSucceeded) {
      dirty = true
      consecutiveRenderFailures++
      if (consecutiveRenderFailures <= MAX_CONSECUTIVE_RENDER_RETRIES) scheduleFrame()
      return false
    }

    markRendered()
    return true
  }

  function continueAnimation(
    motionWasActive: boolean,
    motionShouldContinue: boolean,
    effectSchedule: GeneratedEffectSchedule
  ) {
    const motionContinues = motionShouldContinue && editor.isMotionPreviewActive()
    if (motionContinues) {
      scheduleFrame()
    } else if (motionWasActive && editor.isMotionPreviewActive()) {
      editor.stopMotionPreview()
    }
    if (effectSchedule.active && !motionContinues) {
      scheduleGeneratedEffectFrame(effectSchedule.cadenceHz)
    }
  }

  function renderFrame(timestampMs: number) {
    frameScheduled = false
    if (!pageVisible || suspended || disposed) return
    if (editor.state.loading) {
      dirty = true
      clearGeneratedEffectTimer()
      return
    }

    const motionWasActive = drivesMotion && editor.isMotionPreviewActive()
    const effectSchedule = currentGeneratedEffectSchedule()
    const motionShouldContinue = motionWasActive
      ? editor.updateMotionPreviewFrame(timestampMs)
      : false
    if (motionWasActive || generatedEffectFrameDue) dirty = true
    generatedEffectFrameDue = false
    if (!renderCurrentFrame()) return

    if (!effectSchedule.active) clearGeneratedEffectTimer()
    continueAnimation(motionWasActive, motionShouldContinue, effectSchedule)
  }

  const scheduleFrame = () => {
    if (frameScheduled || suspended || disposed) return
    frameScheduled = true
    scheduler.schedule(renderFrame)
  }

  const scheduleRender = () => {
    dirty = true
    clearGeneratedEffectTimer()
    if (editor.state.loading) return
    scheduleFrame()
  }

  const scheduleSceneRender = () => {
    generatedEffectCacheKey = ''
    scheduleRender()
  }

  const onReducedMotionChange = () => {
    prefersReducedMotion = reducedMotionQuery?.matches ?? false
    generatedEffectCacheKey = ''
    scheduleRender()
  }

  const onVisibilityChange = () => {
    pageVisible = document.visibilityState !== 'hidden'
    clearGeneratedEffectTimer()
    if (pageVisible) {
      scheduleRender()
    } else if (frameScheduled) {
      scheduler.cancel(renderFrame)
      frameScheduled = false
    }
  }

  const unsubscribe = [
    editor.onEditorEvent('render:requested', scheduleSceneRender),
    editor.onEditorEvent('viewport:changed', scheduleRender)
  ]

  unsubscribe.push(editor.onEditorEvent('repaint:requested', scheduleRender))

  if (options.layer !== 'scene') {
    unsubscribe.push(editor.onEditorEvent('overlay:requested', scheduleRender))
  }

  if (shouldScheduleForSelection(options.layer)) {
    unsubscribe.push(editor.onEditorEvent('selection:changed', scheduleRender))
  }

  reducedMotionQuery?.addEventListener('change', onReducedMotionChange)
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange)

  function markRendered() {
    lastRenderVersion = editor.state.renderVersion
    lastSelectedIds = editor.state.selectedIds
    consecutiveRenderFailures = 0
  }

  function pause() {
    disposed = true
    for (const off of unsubscribe) off()
    reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    clearGeneratedEffectTimer()
    if (frameScheduled) {
      scheduler.cancel(renderFrame)
      frameScheduled = false
    }
  }

  function suspend() {
    suspended = true
    clearGeneratedEffectTimer()
    if (!frameScheduled) return
    scheduler.cancel(renderFrame)
    frameScheduled = false
  }

  function resume() {
    if (disposed || !suspended) return
    suspended = false
    scheduleRender()
  }

  return {
    pause,
    suspend,
    resume,
    markRendered,
    markDirty: scheduleRender
  }
}
