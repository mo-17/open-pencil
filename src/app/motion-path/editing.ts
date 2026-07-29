import type {
  MotionCubicPath,
  MotionKeyframe,
  MotionSpec,
  MotionTrack,
  SceneNode
} from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/session'
import { updateNodeMotionWithUndo } from '@/app/properties/motion'

import { isMotionCubicPath, motionPathPointForHandle, setMotionCubicPathHandle } from './spec'
import type { MotionPathEditSelection, MotionPathHandle } from './types'

export interface ResolvedMotionPathEdit {
  selection: MotionPathEditSelection
  node: SceneNode
  motion: MotionSpec
  track: MotionTrack
  keyframe: MotionKeyframe
  path: MotionCubicPath
}

function nodeIsOnPage(store: EditorStore, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.id === store.state.currentPageId) return true
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return false
}

export function resolveMotionPathEdit(store: EditorStore): ResolvedMotionPathEdit | undefined {
  const selection = store.state.motionPathEdit
  if (!selection) return undefined
  const node = store.graph.getNode(selection.nodeId)
  if (!node?.motion || !nodeIsOnPage(store, node)) return undefined
  const track = node.motion.tracks.find((candidate) => candidate.id === selection.trackId)
  const keyframe = track?.keyframes.at(selection.keyframeIndex)
  if (!track || !keyframe || !isMotionCubicPath(track.path)) return undefined
  if (selection.keyframeId && keyframe.id !== selection.keyframeId) return undefined
  return { selection, node, motion: node.motion, track, keyframe, path: track.path }
}

export function startMotionPathEditing(
  store: EditorStore,
  nodeId: string,
  trackId: string,
  keyframeIndex: number
): boolean {
  const node = store.graph.getNode(nodeId)
  const track = node?.motion?.tracks.find((candidate) => candidate.id === trackId)
  const keyframe = track?.keyframes.at(keyframeIndex)
  if (!node || !track || !keyframe || !isMotionCubicPath(track.path)) return false
  store.state.motionPathEdit = {
    nodeId,
    trackId,
    keyframeIndex,
    ...(keyframe.id ? { keyframeId: keyframe.id } : {})
  }
  store.requestRepaint()
  return true
}

export function stopMotionPathEditing(store: EditorStore, nodeId?: string): void {
  if (nodeId && store.state.motionPathEdit?.nodeId !== nodeId) return
  if (!store.state.motionPathEdit) return
  store.state.motionPathEdit = null
  store.requestRepaint()
}

export function syncMotionPathEditingKeyframe(
  store: EditorStore,
  nodeId: string,
  trackId: string,
  keyframeIndex: number
): void {
  const current = store.state.motionPathEdit
  if (!current || current.nodeId !== nodeId) return
  const track = store.graph
    .getNode(nodeId)
    ?.motion?.tracks.find((candidate) => candidate.id === trackId)
  const keyframe = track?.keyframes.at(keyframeIndex)
  if (!track || !keyframe || !isMotionCubicPath(track.path)) {
    stopMotionPathEditing(store, nodeId)
    return
  }
  const focusedHandle = current.focusedHandle
  store.state.motionPathEdit = {
    nodeId,
    trackId,
    keyframeIndex,
    ...(keyframe.id ? { keyframeId: keyframe.id } : {}),
    ...(focusedHandle && motionPathPointForHandle(track.path, focusedHandle)
      ? { focusedHandle }
      : {})
  }
}

export function focusMotionPathHandle(store: EditorStore, handle: MotionPathHandle): void {
  const current = store.state.motionPathEdit
  if (!current) return
  store.state.motionPathEdit = { ...current, focusedHandle: handle }
  store.requestRepaint()
}

export function updateMotionPathHandleWithUndo(
  store: EditorStore,
  handle: MotionPathHandle,
  point: Readonly<Vector>,
  label: string
): boolean {
  const resolved = resolveMotionPathEdit(store)
  if (!resolved) return false
  const next = setMotionCubicPathHandle(resolved.motion, resolved.track.id, handle, point)
  return updateNodeMotionWithUndo(store, resolved.node.id, next, label)
}
