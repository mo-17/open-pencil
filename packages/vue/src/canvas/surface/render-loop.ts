import type { Editor } from '@open-pencil/core/editor'

import type { CanvasRenderLayer } from './types'

type RenderLoopOptions = {
  layer?: CanvasRenderLayer
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
    for (const callback of pending) callback(timestampMs)
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
  renderNow: () => void,
  options: RenderLoopOptions = {}
) {
  const scheduler = getRenderScheduler(editor)
  let dirty = true
  let frameScheduled = false
  let lastRenderVersion = -1
  let lastSelectedIds: Set<string> | null = null

  function renderFrame(timestampMs: number) {
    frameScheduled = false
    if (editor.state.loading) {
      scheduleRender()
      return
    }

    const drivesMotion = shouldDriveMotion(options.layer)
    const motionWasActive = drivesMotion && editor.isMotionPreviewActive()
    const motionShouldContinue = motionWasActive
      ? editor.updateMotionPreviewFrame(timestampMs)
      : false
    if (motionWasActive) dirty = true

    const versionChanged = editor.state.renderVersion !== lastRenderVersion
    const selectionChanged = editor.state.selectedIds !== lastSelectedIds
    if (dirty || versionChanged || selectionChanged) {
      dirty = false
      renderNow()
    }

    if (!motionWasActive) return
    if (motionShouldContinue && editor.isMotionPreviewActive()) scheduleFrame()
    else if (editor.isMotionPreviewActive()) editor.stopMotionPreview()
  }

  const scheduleFrame = () => {
    if (frameScheduled) return
    frameScheduled = true
    scheduler.schedule(renderFrame)
  }

  const scheduleRender = () => {
    dirty = true
    scheduleFrame()
  }

  const unsubscribe = [
    editor.onEditorEvent('render:requested', scheduleRender),
    editor.onEditorEvent('viewport:changed', scheduleRender)
  ]

  unsubscribe.push(editor.onEditorEvent('repaint:requested', scheduleRender))

  if (shouldScheduleForSelection(options.layer)) {
    unsubscribe.push(editor.onEditorEvent('selection:changed', scheduleRender))
  }

  function markRendered() {
    lastRenderVersion = editor.state.renderVersion
    lastSelectedIds = editor.state.selectedIds
  }

  function pause() {
    for (const off of unsubscribe) off()
    if (frameScheduled) {
      scheduler.cancel(renderFrame)
      frameScheduled = false
    }
  }

  return {
    pause,
    markRendered,
    markDirty: scheduleRender
  }
}
