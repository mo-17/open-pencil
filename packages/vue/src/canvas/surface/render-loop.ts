import {
  canvasPerformanceProfile,
  normalizeCanvasPerformanceMode,
  type CanvasPerformanceMode,
  type CanvasPerformanceProfile
} from '@open-pencil/core/canvas'
import type { Editor, EditorState } from '@open-pencil/core/editor'
import {
  validateGeneratedEffectSpec,
  type GeneratedEffectPreset,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { CanvasActiveFrameSample, CanvasRenderLayer } from './types'

type RenderLoopOptions = {
  layer?: CanvasRenderLayer
  getRenderState?: () => EditorState
  performanceMode?: CanvasPerformanceMode
  onActiveFrameSample?: (sample: CanvasActiveFrameSample) => void
}

const MAX_CONSECUTIVE_RENDER_RETRIES = 2
const ACTIVE_FRAME_IDLE_GAP_MS = 250
const readNow = () => (typeof performance === 'undefined' ? 0 : performance.now())

type GeneratedEffectSchedule = {
  active: boolean
  cadenceHz: number
  continuous: boolean
}

function generatedEffectCadence(
  preset: GeneratedEffectPreset,
  frequencyHz: number,
  profile: Readonly<CanvasPerformanceProfile>
): Pick<GeneratedEffectSchedule, 'cadenceHz' | 'continuous'> {
  if (preset !== 'noise') {
    return profile.smoothGeneratedEffectCadence === 'animation-frame'
      ? { cadenceHz: 0, continuous: true }
      : { cadenceHz: profile.smoothGeneratedEffectCadence, continuous: false }
  }
  return {
    cadenceHz: Math.min(profile.noiseGeneratedEffectFpsCap, Math.max(1, frequencyHz)),
    continuous: false
  }
}

function animatedGeneratedEffectSchedule(
  graph: SceneGraph,
  pageId: string,
  prefersReducedMotion: boolean,
  profile: Readonly<CanvasPerformanceProfile>
): GeneratedEffectSchedule {
  if (prefersReducedMotion) return { active: false, cadenceHz: 0, continuous: false }
  const page = graph.getNode(pageId)
  if (!page) return { active: false, cadenceHz: 0, continuous: false }
  const pending: SceneNode[] = [page]
  let cadenceHz = 0
  let continuous = false
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
    const cadence = generatedEffectCadence(
      result.value.params.preset,
      time.frequencyHz * time.scale,
      profile
    )
    cadenceHz = Math.max(cadenceHz, cadence.cadenceHz)
    continuous ||= cadence.continuous
  }
  return { active: continuous || cadenceHz > 0, cadenceHz, continuous }
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
  const getRenderState = options.getRenderState ?? (() => editor.state)
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
  let lastSceneVersion = -1
  let lastSelectedIds: Set<string> | null = null
  let generatedEffectTimer: ReturnType<typeof setTimeout> | null = null
  let generatedEffectFrameDue = false
  let generatedEffectCacheKey = ''
  let generatedEffectSchedule: GeneratedEffectSchedule = {
    active: false,
    cadenceHz: 0,
    continuous: false
  }
  let performanceMode = normalizeCanvasPerformanceMode(options.performanceMode)
  let consecutiveRenderFailures = 0
  let activeSamplePending = false
  let lastActiveFrameTimestamp: number | null = null
  const runtimeDocument: Document | undefined =
    typeof document === 'undefined' ? undefined : document
  let pageVisible = runtimeDocument?.visibilityState !== 'hidden'
  let suspended = false
  let disposed = false

  function currentGeneratedEffectSchedule(): GeneratedEffectSchedule {
    if (!drivesMotion) return { active: false, cadenceHz: 0, continuous: false }
    const state = getRenderState()
    const cacheKey = `${state.currentPageId}:${state.sceneVersion}:${prefersReducedMotion}:${performanceMode}`
    if (cacheKey !== generatedEffectCacheKey) {
      generatedEffectCacheKey = cacheKey
      generatedEffectSchedule = animatedGeneratedEffectSchedule(
        editor.graph,
        state.currentPageId,
        prefersReducedMotion,
        canvasPerformanceProfile(performanceMode)
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

  function reportActiveFrame(
    timestampMs: number,
    renderDurationMs: number,
    measureFrameInterval: boolean
  ): void {
    if (!drivesMotion || !options.onActiveFrameSample) return
    const interval =
      measureFrameInterval && lastActiveFrameTimestamp !== null
        ? timestampMs - lastActiveFrameTimestamp
        : undefined
    if (measureFrameInterval) lastActiveFrameTimestamp = timestampMs
    options.onActiveFrameSample({
      timestampMs,
      renderDurationMs,
      ...(interval !== undefined && interval > 0 && interval <= ACTIVE_FRAME_IDLE_GAP_MS
        ? { frameIntervalMs: interval }
        : {})
    })
  }

  function renderCurrentFrame(
    timestampMs: number,
    activeFrame: boolean,
    measureFrameInterval: boolean
  ): boolean {
    const state = getRenderState()
    const versionChanged = state.renderVersion !== lastRenderVersion
    const sceneChanged = state.sceneVersion !== lastSceneVersion
    const selectionChanged = state.selectedIds !== lastSelectedIds
    if (!dirty && !versionChanged && !sceneChanged && !selectionChanged) return true

    dirty = false
    let renderSucceeded = true
    const renderStartedAt = activeFrame ? readNow() : 0
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
    if (activeFrame) {
      reportActiveFrame(timestampMs, Math.max(0, readNow() - renderStartedAt), measureFrameInterval)
    }
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
    if (effectSchedule.continuous && !motionContinues) {
      scheduleFrame()
    } else if (effectSchedule.active && !motionContinues) {
      scheduleGeneratedEffectFrame(effectSchedule.cadenceHz)
    }
  }

  function renderFrame(timestampMs: number) {
    frameScheduled = false
    if (!pageVisible || suspended || disposed) return
    if (getRenderState().loading) {
      dirty = true
      clearGeneratedEffectTimer()
      return
    }

    // The active pane owns the editor Motion clock. Other scene panes still render and schedule
    // against the shared preview so they see every sampled frame without sampling it twice.
    const motionWasActive = drivesMotion && editor.isMotionPreviewActive()
    const ownsMotionClock = motionWasActive && getRenderState() === editor.state
    const effectSchedule = currentGeneratedEffectSchedule()
    const motionShouldContinue = ownsMotionClock
      ? editor.updateMotionPreviewFrame(timestampMs)
      : motionWasActive
    const measureFrameInterval = activeSamplePending || motionWasActive || effectSchedule.continuous
    const activeFrame = measureFrameInterval || generatedEffectFrameDue
    activeSamplePending = false
    if (motionWasActive || effectSchedule.continuous || generatedEffectFrameDue) dirty = true
    generatedEffectFrameDue = false
    if (!renderCurrentFrame(timestampMs, activeFrame, measureFrameInterval)) return

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
    if (getRenderState().loading) return
    scheduleFrame()
  }

  const scheduleSceneRender = () => {
    generatedEffectCacheKey = ''
    activeSamplePending = true
    scheduleRender()
  }

  const scheduleActiveRender = () => {
    activeSamplePending = true
    scheduleFrame()
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
    editor.onEditorEvent('viewport:changed', scheduleActiveRender)
  ]

  // Repaints can represent cache/font/loading changes that are not reflected in a pane-local
  // renderVersion, so every view must redraw even when its supplied state is otherwise unchanged.
  unsubscribe.push(editor.onEditorEvent('repaint:requested', scheduleRender))

  if (options.layer !== 'scene') {
    unsubscribe.push(editor.onEditorEvent('overlay:requested', scheduleRender))
  }
  if (shouldScheduleForSelection(options.layer)) {
    unsubscribe.push(editor.onEditorEvent('selection:changed', scheduleFrame))
  }

  reducedMotionQuery?.addEventListener('change', onReducedMotionChange)
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange)

  function markRendered() {
    const state = getRenderState()
    lastRenderVersion = state.renderVersion
    lastSceneVersion = state.sceneVersion
    lastSelectedIds = state.selectedIds
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
    activeSamplePending = false
    lastActiveFrameTimestamp = null
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

  function setPerformanceMode(mode: CanvasPerformanceMode) {
    const normalized = normalizeCanvasPerformanceMode(mode)
    if (normalized === performanceMode) return
    performanceMode = normalized
    generatedEffectCacheKey = ''
    clearGeneratedEffectTimer()
    scheduleRender()
  }

  return {
    pause,
    suspend,
    resume,
    setPerformanceMode,
    markRendered,
    markDirty: scheduleRender
  }
}
