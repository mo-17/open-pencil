import {
  cloneMotionSceneSpec,
  MOTION_SCENE_LIMITS,
  parseMotionSceneSpec,
  type MotionSceneCue,
  type MotionSceneMarker,
  type MotionSceneSpec,
  type MotionSceneTrigger,
  type MotionSpec,
  type MotionTrack,
  type SceneNode
} from '@open-pencil/scene-graph'

import { updateNodeMotionWithUndo, type MotionMutationEditor } from '../motion'
import {
  addMotionKeyframe,
  motionOffsetAtTime,
  setMotionKeyframeChannel,
  type MotionChannel
} from './timeline'

export interface MotionSceneCueInput {
  targetNodeId: string
  trackId: string
  startMs: number
  timeScale?: number
}

export type MotionSceneCueChanges = Partial<
  Pick<MotionSceneCue, 'startMs' | 'timeScale' | 'enabled'>
>

export interface MotionSceneAvailableTrack {
  key: string
  targetNodeId: string
  targetName: string
  trackId: string
  trackName: string
  durationMs: number
}

export interface MotionSceneGraphReader {
  getNode(id: string): SceneNode | undefined
  getChildren(id: string): SceneNode[]
}

export type MotionSceneMutationEditor = MotionMutationEditor

export interface MotionSceneAutoKeyframeInput {
  scene: MotionSceneSpec
  sequenceId: string
  cueIds: ReadonlySet<string>
  sceneTimeMs: number
  channel: MotionChannel
  value: number
}

export function motionSceneTrackKey(targetNodeId: string, trackId: string): string {
  return JSON.stringify([targetNodeId, trackId])
}

/** One deterministic cycle, including authored delay. Infinite/loop tracks stay finite in authoring. */
export function motionSceneTrackDurationMs(track: MotionTrack): number {
  const iterations =
    track.timing.iterations === 'infinite' ||
    (track.trigger === 'loop' && track.timing.iterations === undefined)
      ? 1
      : (track.timing.iterations ?? 1)
  return (track.timing.delayMs ?? 0) + track.timing.durationMs * iterations
}

/** Map a scene playhead to the referenced node-local track, including cue speed. */
export function motionSceneCueTrackOffsetAtTime(
  cue: MotionSceneCue,
  track: MotionTrack,
  sceneTimeMs: number
): number {
  const boundedSceneTime = Number.isFinite(sceneTimeMs) ? Math.max(0, sceneTimeMs) : 0
  const localTimeMs = Math.max(0, boundedSceneTime - cue.startMs) * (cue.timeScale ?? 1)
  return motionOffsetAtTime(track, localTimeMs)
}

/**
 * Insert or update one channel at the shared scene playhead for every selected cue.
 * All target-node snapshots are prepared before the first write and committed as one undo step.
 */
export function autoKeyframeMotionSceneCues(
  editor: MotionSceneMutationEditor,
  input: MotionSceneAutoKeyframeInput,
  label: string,
  coalesceKey?: string
): number {
  if (input.cueIds.size === 0) return 0
  const scene = parseMotionSceneSpec(input.scene)
  const sequence = scene.sequences[sequenceIndex(scene, input.sequenceId)]
  const cues = sequence.cues.filter(({ id }) => input.cueIds.has(id))
  if (cues.length !== input.cueIds.size) {
    const missing = [...input.cueIds].find((id) => !cues.some((cue) => cue.id === id))
    throw new RangeError(`Unknown Motion scene cue: ${missing ?? ''}`)
  }

  const updates = new Map<string, MotionSpec>()
  for (const cue of cues) {
    const node = editor.graph.getNode(cue.targetNodeId)
    const current = updates.get(cue.targetNodeId) ?? node?.motion
    if (!node || !current) {
      throw new RangeError(`Motion scene cue target has no MotionSpec: ${cue.targetNodeId}`)
    }
    const track = current.tracks.find(({ id }) => id === cue.trackId)
    if (!track) {
      throw new RangeError(`Unknown Motion scene cue track: ${cue.targetNodeId}/${cue.trackId}`)
    }
    const inserted = addMotionKeyframe(
      current,
      cue.trackId,
      motionSceneCueTrackOffsetAtTime(cue, track, input.sceneTimeMs)
    )
    updates.set(
      cue.targetNodeId,
      setMotionKeyframeChannel(
        inserted.spec,
        cue.trackId,
        inserted.index,
        input.channel,
        input.value
      )
    )
  }

  return editor.undo.runBatch(
    label,
    () => {
      let changed = 0
      for (const [nodeId, motion] of updates) {
        if (updateNodeMotionWithUndo(editor, nodeId, motion, label)) changed++
      }
      return changed
    },
    coalesceKey
  )
}

/** Enumerate descendant-only, node-local tracks not already referenced by the selected sequence. */
export function collectMotionSceneAvailableTracks(
  graph: MotionSceneGraphReader,
  ownerNodeId: string,
  scene: MotionSceneSpec,
  sequenceId: string
): MotionSceneAvailableTrack[] {
  const sequence = scene.sequences[sequenceIndex(scene, sequenceId)]
  const used = new Set(
    sequence.cues.map(({ targetNodeId, trackId }) => motionSceneTrackKey(targetNodeId, trackId))
  )
  const result: MotionSceneAvailableTrack[] = []
  const pending = [...graph.getChildren(ownerNodeId)].toReversed()
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) continue
    for (const child of graph.getChildren(node.id).toReversed()) pending.push(child)
    for (const track of node.motion?.tracks ?? []) {
      const key = motionSceneTrackKey(node.id, track.id)
      if (used.has(key)) continue
      result.push({
        key,
        targetNodeId: node.id,
        targetName: node.name,
        trackId: track.id,
        trackName: track.name ?? track.id,
        durationMs: motionSceneTrackDurationMs(track)
      })
    }
  }
  return result
}

/** Store the complete choreography on its page/frame owner as one undoable snapshot. */
export function updateMotionSceneWithUndo(
  editor: MotionSceneMutationEditor,
  ownerNodeId: string,
  scene: MotionSceneSpec,
  label: string,
  coalesceKey?: string
): boolean {
  const owner = editor.graph.getNode(ownerNodeId)
  if (!owner) return false
  if (owner.type !== 'CANVAS' && owner.type !== 'FRAME') {
    throw new RangeError('A Motion scene owner must be a page or frame')
  }
  const next = parseMotionSceneSpec(scene)
  if (JSON.stringify(owner.motionScene) === JSON.stringify(next)) return false
  editor.undo.runBatch(
    label,
    () => editor.updateNodeWithUndo(ownerNodeId, { motionScene: next }, label),
    coalesceKey
  )
  return true
}

function nextId(existing: Iterable<string>, prefix: string): string {
  const ids = new Set(existing)
  for (let index = 1; index <= 10_000; index++) {
    const id = `${prefix}-${index}`
    if (!ids.has(id)) return id
  }
  throw new RangeError(`Unable to allocate a unique ${prefix} id`)
}

function boundedTime(value: number): number {
  const normalized = Number.isFinite(value) ? value : 0
  return Math.min(MOTION_SCENE_LIMITS.timeMs.max, Math.max(0, normalized))
}

function sequenceIndex(scene: MotionSceneSpec, sequenceId: string): number {
  const index = scene.sequences.findIndex((sequence) => sequence.id === sequenceId)
  if (index === -1) throw new RangeError(`Unknown Motion scene sequence: ${sequenceId}`)
  return index
}

function editScene(
  scene: MotionSceneSpec,
  edit: (draft: MotionSceneSpec) => void
): MotionSceneSpec {
  const draft = cloneMotionSceneSpec(scene)
  edit(draft)
  return parseMotionSceneSpec(draft)
}

export function createMotionSceneSpec(id = 'scene'): MotionSceneSpec {
  return parseMotionSceneSpec({
    version: 1,
    id,
    sequences: [{ id: 'sequence-1', name: 'Scene 1', trigger: 'pageEnter', cues: [] }]
  })
}

export function addMotionSceneSequence(
  scene: MotionSceneSpec,
  trigger: MotionSceneTrigger = 'manual'
): { scene: MotionSceneSpec; sequenceId: string } {
  const sequenceId = nextId(
    scene.sequences.map(({ id }) => id),
    'sequence'
  )
  return {
    sequenceId,
    scene: editScene(scene, (draft) => {
      draft.sequences.push({
        id: sequenceId,
        name: `Scene ${draft.sequences.length + 1}`,
        trigger,
        cues: []
      })
    })
  }
}

export function removeMotionSceneSequence(
  scene: MotionSceneSpec,
  sequenceId: string
): MotionSceneSpec {
  if (scene.sequences.length <= 1) throw new RangeError('A Motion scene requires one sequence')
  return editScene(scene, (draft) => {
    draft.sequences.splice(sequenceIndex(draft, sequenceId), 1)
  })
}

export function addMotionSceneCue(
  scene: MotionSceneSpec,
  sequenceId: string,
  input: MotionSceneCueInput
): { scene: MotionSceneSpec; cueId: string } {
  const sequence = scene.sequences[sequenceIndex(scene, sequenceId)]
  if (
    sequence.cues.some(
      (cue) => cue.targetNodeId === input.targetNodeId && cue.trackId === input.trackId
    )
  ) {
    throw new RangeError(`Track ${input.targetNodeId}/${input.trackId} is already in the sequence`)
  }
  const cueId = nextId(
    sequence.cues.map(({ id }) => id),
    'cue'
  )
  return {
    cueId,
    scene: editScene(scene, (draft) => {
      draft.sequences[sequenceIndex(draft, sequenceId)].cues.push({
        id: cueId,
        targetNodeId: input.targetNodeId,
        trackId: input.trackId,
        startMs: boundedTime(input.startMs),
        ...(input.timeScale === undefined ? {} : { timeScale: input.timeScale })
      })
    })
  }
}

export function updateMotionSceneCue(
  scene: MotionSceneSpec,
  sequenceId: string,
  cueId: string,
  changes: MotionSceneCueChanges
): MotionSceneSpec {
  return updateMotionSceneCues(scene, sequenceId, new Set([cueId]), changes)
}

/** Apply one cue-field edit to any number of targets while parsing and committing one snapshot. */
export function updateMotionSceneCues(
  scene: MotionSceneSpec,
  sequenceId: string,
  cueIds: ReadonlySet<string>,
  changes: MotionSceneCueChanges
): MotionSceneSpec {
  if (cueIds.size === 0) return scene
  return editScene(scene, (draft) => {
    const sequence = draft.sequences[sequenceIndex(draft, sequenceId)]
    const matches = sequence.cues.filter((candidate) => cueIds.has(candidate.id))
    if (matches.length !== cueIds.size) {
      const missing = [...cueIds].find((id) => !matches.some((cue) => cue.id === id))
      throw new RangeError(`Unknown Motion scene cue: ${missing ?? ''}`)
    }
    for (const cue of matches) {
      if (changes.startMs !== undefined) cue.startMs = boundedTime(changes.startMs)
      if (changes.timeScale !== undefined) cue.timeScale = changes.timeScale
      if (changes.enabled !== undefined) cue.enabled = changes.enabled
    }
  })
}

export function removeMotionSceneCues(
  scene: MotionSceneSpec,
  sequenceId: string,
  cueIds: ReadonlySet<string>
): MotionSceneSpec {
  if (cueIds.size === 0) return scene
  return editScene(scene, (draft) => {
    const sequence = draft.sequences[sequenceIndex(draft, sequenceId)]
    sequence.cues = sequence.cues.filter((cue) => !cueIds.has(cue.id))
  })
}

export function addMotionSceneMarker(
  scene: MotionSceneSpec,
  sequenceId: string,
  timeMs: number,
  label = 'Marker'
): { scene: MotionSceneSpec; markerId: string } {
  const sequence = scene.sequences[sequenceIndex(scene, sequenceId)]
  const markerId = nextId(
    (sequence.markers ?? []).map(({ id }) => id),
    'marker'
  )
  return {
    markerId,
    scene: editScene(scene, (draft) => {
      const target = draft.sequences[sequenceIndex(draft, sequenceId)]
      const markers: MotionSceneMarker[] = [
        ...(target.markers ?? []),
        { id: markerId, timeMs: boundedTime(timeMs), label }
      ]
      target.markers = markers.sort((left, right) => left.timeMs - right.timeMs)
    })
  }
}

export function removeMotionSceneMarker(
  scene: MotionSceneSpec,
  sequenceId: string,
  markerId: string
): MotionSceneSpec {
  return editScene(scene, (draft) => {
    const sequence = draft.sequences[sequenceIndex(draft, sequenceId)]
    sequence.markers = (sequence.markers ?? []).filter((marker) => marker.id !== markerId)
    if (sequence.markers.length === 0) delete sequence.markers
  })
}

export function snapMotionSceneTime(
  scene: MotionSceneSpec,
  sequenceId: string,
  timeMs: number,
  gridMs: number,
  thresholdMs: number,
  excludedCueIds: ReadonlySet<string> = new Set()
): number {
  const normalized = boundedTime(timeMs)
  const sequence = scene.sequences[sequenceIndex(scene, sequenceId)]
  const candidates = [
    ...(gridMs > 0 ? [Math.round(normalized / gridMs) * gridMs] : []),
    ...sequence.cues.filter(({ id }) => !excludedCueIds.has(id)).map(({ startMs }) => startMs),
    ...(sequence.markers ?? []).map(({ timeMs: markerTime }) => markerTime)
  ]
  let nearest = normalized
  let distance = Math.max(0, thresholdMs)
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - normalized)
    if (nextDistance <= distance) {
      nearest = candidate
      distance = nextDistance
    }
  }
  return boundedTime(nearest)
}

export function translateMotionSceneCues(
  scene: MotionSceneSpec,
  sequenceId: string,
  cueIds: ReadonlySet<string>,
  deltaMs: number,
  snap?: { gridMs: number; thresholdMs: number }
): MotionSceneSpec {
  const sequence = scene.sequences[sequenceIndex(scene, sequenceId)]
  const selected = sequence.cues.filter((cue) => cueIds.has(cue.id))
  if (selected.length === 0) return scene
  const earliest = Math.min(...selected.map(({ startMs }) => startMs))
  const latest = Math.max(...selected.map(({ startMs }) => startMs))
  const boundedDelta = Math.min(
    MOTION_SCENE_LIMITS.timeMs.max - latest,
    Math.max(-earliest, Number.isFinite(deltaMs) ? deltaMs : 0)
  )
  const proposedAnchor = earliest + boundedDelta
  const snappedAnchor = snap
    ? snapMotionSceneTime(scene, sequenceId, proposedAnchor, snap.gridMs, snap.thresholdMs, cueIds)
    : proposedAnchor
  const snappedDelta = Math.min(
    MOTION_SCENE_LIMITS.timeMs.max - latest,
    Math.max(-earliest, snappedAnchor - earliest)
  )
  return editScene(scene, (draft) => {
    const cues = draft.sequences[sequenceIndex(draft, sequenceId)].cues
    for (const cue of cues) if (cueIds.has(cue.id)) cue.startMs += snappedDelta
  })
}

export function scaleMotionSceneCues(
  scene: MotionSceneSpec,
  sequenceId: string,
  cueIds: ReadonlySet<string>,
  factor: number,
  anchorMs: number
): MotionSceneSpec {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('Scale factor must be positive')
  const boundedAnchor = boundedTime(anchorMs)
  return editScene(scene, (draft) => {
    const cues = draft.sequences[sequenceIndex(draft, sequenceId)].cues
    for (const cue of cues) {
      if (!cueIds.has(cue.id)) continue
      cue.startMs = boundedTime(boundedAnchor + (cue.startMs - boundedAnchor) * factor)
    }
  })
}
