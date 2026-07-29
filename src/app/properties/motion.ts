import { inspectMotionNodeCapabilities } from '@open-pencil/core/motion'
import {
  cloneMotionSpec,
  createMotionPreset,
  expandMotionPreset,
  isMotionPresetId,
  MOTION_PRESET_REGISTRY,
  parseMotionSpec,
  renameNodeLowcodeMotionTrackReferences,
  type MotionPresetId,
  type MotionPresetParameterName,
  type MotionSpec,
  type MotionStaggerOptions,
  type MotionTrigger,
  type SceneNode,
  withMotionStagger
} from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

export const MOTION_MIXED = Symbol('motion-mixed')

export type MotionReducedMotion = NonNullable<MotionSpec['reducedMotion']>
export type MotionReducedMotionChoice = MotionReducedMotion | 'default'
export type MotionPresetSelection = MotionPresetId | 'custom' | typeof MOTION_MIXED | undefined
export type MotionSharedValue<T> = T | typeof MOTION_MIXED | undefined

export interface MotionSelectionState {
  count: number
  hasMotion: boolean
  allHaveMotion: boolean
  mixed: boolean
  presetId: MotionPresetSelection
  trigger: MotionSharedValue<MotionTrigger>
  durationMs: MotionSharedValue<number>
  delayMs: MotionSharedValue<number>
  reducedMotion: MotionSharedValue<MotionReducedMotionChoice>
  distance: MotionSharedValue<number>
  intensity: MotionSharedValue<number>
}

export interface MotionMutationEditor {
  graph: {
    getNode(id: string): SceneNode | undefined
    getAbsolutePosition(id: string): Vector
  }
  undo: {
    runBatch<T>(label: string, apply: () => T, coalesceKey?: string): T
  }
  updateNodeWithUndo(id: string, changes: Partial<SceneNode>, label?: string): void
}

export interface MotionApplication {
  nodeId: string
  motion: MotionSpec
}

interface MotionUpdate {
  id: string
  motion: MotionSpec | undefined
}

const SKIP_MOTION = Symbol('skip-motion')

function sharedValue<T>(values: readonly (T | typeof MOTION_MIXED | undefined)[]) {
  if (values.length === 0) return undefined
  const first = values[0]
  return values.every((value) => Object.is(value, first)) ? first : MOTION_MIXED
}

function trackValue<T>(motion: MotionSpec, read: (track: MotionSpec['tracks'][number]) => T) {
  return sharedValue(motion.tracks.map(read))
}

function presetSelection(motion: MotionSpec | undefined): MotionPresetId | 'custom' | undefined {
  if (!motion) return undefined
  const id = motion.preset?.id
  if (!isMotionPresetId(id) || motion.preset?.version !== MOTION_PRESET_REGISTRY[id].version) {
    return 'custom'
  }

  let expanded: MotionSpec
  try {
    expanded = expandMotionPreset(motion.preset)
  } catch {
    return 'custom'
  }
  if (expanded.tracks.length !== motion.tracks.length) return 'custom'
  for (const [index, track] of expanded.tracks.entries()) {
    track.trigger = motion.tracks[index].trigger
  }
  if (motion.reducedMotion === undefined) delete expanded.reducedMotion
  else expanded.reducedMotion = motion.reducedMotion
  delete expanded.preset

  const comparable = cloneMotionSpec(motion)
  delete comparable.preset
  return JSON.stringify(expanded) === JSON.stringify(comparable) ? id : 'custom'
}

function presetParameter(
  motion: MotionSpec | undefined,
  name: MotionPresetParameterName
): number | undefined {
  if (!motion) return undefined
  const presetId = presetSelection(motion)
  if (!presetId || presetId === 'custom') return undefined
  const definition = MOTION_PRESET_REGISTRY[presetId].parameters[name]
  if (!definition) return undefined
  const stored = motion.preset?.parameters[name]
  return typeof stored === 'number' ? stored : definition.defaultValue
}

export function readMotionSelection(nodes: readonly SceneNode[]): MotionSelectionState {
  const motions = nodes.map((node) => node.motion)
  const hasMotion = motions.some(Boolean)
  const allHaveMotion = nodes.length > 0 && motions.every(Boolean)
  const motionSignatures = motions.map((motion) =>
    motion === undefined ? undefined : JSON.stringify(motion)
  )

  return {
    count: nodes.length,
    hasMotion,
    allHaveMotion,
    mixed: sharedValue(motionSignatures) === MOTION_MIXED,
    presetId: sharedValue(motions.map(presetSelection)),
    trigger: sharedValue(
      motions.map((motion) => (motion ? trackValue(motion, (track) => track.trigger) : undefined))
    ),
    durationMs: sharedValue(
      motions.map((motion) =>
        motion ? trackValue(motion, (track) => track.timing.durationMs) : undefined
      )
    ),
    delayMs: sharedValue(
      motions.map((motion) =>
        motion ? trackValue(motion, (track) => track.timing.delayMs ?? 0) : undefined
      )
    ),
    reducedMotion: sharedValue(
      motions.map((motion) => (motion ? (motion.reducedMotion ?? 'default') : undefined))
    ),
    distance: sharedValue(motions.map((motion) => presetParameter(motion, 'distance'))),
    intensity: sharedValue(motions.map((motion) => presetParameter(motion, 'intensity')))
  }
}

function sameMotion(left: MotionSpec | undefined, right: MotionSpec | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function motionOverrideValue(motion: MotionSpec | undefined): MotionSpec | null {
  return motion ? cloneMotionSpec(motion) : null
}

function hasCurrentMotionOverride(node: SceneNode, motion: MotionSpec | undefined): boolean {
  if (node.type !== 'INSTANCE') return true
  if (!Object.hasOwn(node.overrides, 'motion')) return false
  const override = node.overrides.motion
  if (!motion) return override === null
  if (!override || typeof override !== 'object') return false
  return JSON.stringify(override) === JSON.stringify(motion)
}

function nodeMotionChanges(node: SceneNode, motion: MotionSpec | undefined): Partial<SceneNode> {
  if (node.type !== 'INSTANCE') return { motion }
  return {
    motion,
    overrides: {
      ...node.overrides,
      motion: motionOverrideValue(motion)
    }
  }
}

function needsNodeMotionUpdate(node: SceneNode, motion: MotionSpec | undefined): boolean {
  return !sameMotion(node.motion, motion) || !hasCurrentMotionOverride(node, motion)
}

function compareNodeIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function spatialMotionTargetIds(
  editor: MotionMutationEditor,
  nodeIds: readonly string[]
): string[] {
  return [...new Set(nodeIds)]
    .filter((id) => editor.graph.getNode(id) !== undefined)
    .map((id) => ({ id, position: editor.graph.getAbsolutePosition(id) }))
    .sort(
      (left, right) =>
        left.position.y - right.position.y ||
        left.position.x - right.position.x ||
        compareNodeIds(left.id, right.id)
    )
    .map(({ id }) => id)
}

/** Build fully validated per-node snapshots before any graph mutation or undo entry is created. */
export function buildMotionApplications(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  motion: MotionSpec,
  stagger?: MotionStaggerOptions
): MotionApplication[] {
  const validated = parseMotionSpec(motion)
  const ids = stagger ? spatialMotionTargetIds(editor, nodeIds) : [...new Set(nodeIds)]
  const existingIds = ids.filter((id) => editor.graph.getNode(id) !== undefined)
  return existingIds.map((nodeId, index) => ({
    nodeId,
    motion: stagger
      ? withMotionStagger(validated, index, existingIds.length, stagger)
      : cloneMotionSpec(validated)
  }))
}

export function applyMotionApplications(
  editor: MotionMutationEditor,
  applications: readonly MotionApplication[],
  label: string
): number {
  const updates = applications
    .map(({ nodeId, motion }) => ({
      id: nodeId,
      node: editor.graph.getNode(nodeId),
      motion: parseMotionSpec(motion)
    }))
    .filter(
      (update): update is { id: string; node: SceneNode; motion: MotionSpec } =>
        update.node !== undefined && needsNodeMotionUpdate(update.node, update.motion)
    )
  const incompatible = updates.flatMap(({ node, motion }) =>
    inspectMotionNodeCapabilities(node, motion).map(
      ({ path, message }) => `MotionSpec is incompatible with node ${node.id}: ${path}: ${message}`
    )
  )
  if (incompatible.length > 0) throw new Error(incompatible.join('; '))
  return commitMotionUpdates(editor, updates, label)
}

/** Commit one authored Motion value while preserving root-instance inheritance semantics. */
export function updateNodeMotionWithUndo(
  editor: MotionMutationEditor,
  nodeId: string,
  motion: MotionSpec | undefined,
  label: string
): boolean {
  const node = editor.graph.getNode(nodeId)
  if (!node) return false
  const validated = motion ? parseMotionSpec(motion) : undefined
  if (!needsNodeMotionUpdate(node, validated)) return false
  editor.updateNodeWithUndo(nodeId, nodeMotionChanges(node, validated), label)
  return true
}

type MotionTrackReferenceMutationEditor = MotionMutationEditor & {
  graph: MotionMutationEditor['graph'] & {
    getAllNodes(): Iterable<SceneNode>
  }
}

/** Rename a track and every matching low-code action reference as one undo step. */
export function renameMotionTrackWithReferences(
  editor: MotionTrackReferenceMutationEditor,
  nodeId: string,
  motion: MotionSpec,
  previousTrackId: string,
  nextTrackId: string,
  label: string
): boolean {
  const node = editor.graph.getNode(nodeId)
  if (!node) return false
  const validated = parseMotionSpec(motion)
  const updateMotion = needsNodeMotionUpdate(node, validated)
  const referenceUpdates = [...editor.graph.getAllNodes()].flatMap((candidate) => {
    const changes = renameNodeLowcodeMotionTrackReferences(
      candidate,
      nodeId,
      previousTrackId,
      nextTrackId
    )
    return changes ? [{ id: candidate.id, changes }] : []
  })
  if (!updateMotion && referenceUpdates.length === 0) return false

  editor.undo.runBatch(label, () => {
    if (updateMotion) updateNodeMotionWithUndo(editor, nodeId, validated, label)
    for (const update of referenceUpdates) {
      editor.updateNodeWithUndo(update.id, update.changes, label)
    }
  })
  return true
}

function commitMotionUpdates(
  editor: MotionMutationEditor,
  updates: readonly MotionUpdate[],
  label: string
): number {
  if (updates.length === 0) return 0

  editor.undo.runBatch(label, () => {
    for (const update of updates) {
      updateNodeMotionWithUndo(editor, update.id, update.motion, label)
    }
  })
  return updates.length
}

function mutateSelectedMotion(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  label: string,
  mutate: (
    motion: MotionSpec | undefined,
    node: SceneNode
  ) => MotionSpec | undefined | typeof SKIP_MOTION
): number {
  const updates: Array<{ id: string; motion: MotionSpec | undefined }> = []
  for (const id of new Set(nodeIds)) {
    const node = editor.graph.getNode(id)
    if (!node) continue
    const result = mutate(node.motion, node)
    if (result === SKIP_MOTION) continue
    const motion = result ? parseMotionSpec(result) : undefined
    if (needsNodeMotionUpdate(node, motion)) updates.push({ id, motion })
  }
  return commitMotionUpdates(editor, updates, label)
}

export function applyMotionPreset(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  presetId: MotionPresetId,
  label: string,
  stagger?: MotionStaggerOptions
): number {
  const preset = createMotionPreset(presetId)
  return applyMotionApplications(
    editor,
    buildMotionApplications(editor, nodeIds, preset, stagger),
    label
  )
}

/** Replace the selection with one complete MotionSpec snapshot, optionally staggered. */
export function applyMotionSpec(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  motion: MotionSpec,
  label: string,
  stagger?: MotionStaggerOptions
): number {
  return applyMotionApplications(
    editor,
    buildMotionApplications(editor, nodeIds, motion, stagger),
    label
  )
}

export function clearSelectedMotion(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  label: string
): number {
  return mutateSelectedMotion(editor, nodeIds, label, (motion) =>
    motion ? undefined : SKIP_MOTION
  )
}

function updateExistingMotion(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  label: string,
  update: (motion: MotionSpec) => MotionSpec
): number {
  return mutateSelectedMotion(editor, nodeIds, label, (motion) =>
    motion ? update(motion) : SKIP_MOTION
  )
}

export function setMotionTrigger(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  trigger: MotionTrigger,
  label: string
): number {
  return updateExistingMotion(editor, nodeIds, label, (motion) => {
    const next = cloneMotionSpec(motion)
    for (const track of next.tracks) track.trigger = trigger
    if (presetSelection(motion) === 'custom') delete next.preset
    return parseMotionSpec(next)
  })
}

export function setMotionTiming(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  field: 'durationMs' | 'delayMs',
  value: number,
  label: string
): number {
  return updateExistingMotion(editor, nodeIds, label, (motion) => {
    const next = cloneMotionSpec(motion)
    for (const track of next.tracks) track.timing[field] = value
    if (presetSelection(motion) === 'custom') delete next.preset
    else if (next.preset && Object.hasOwn(next.preset.parameters, field)) {
      next.preset.parameters[field] = value
    }
    return parseMotionSpec(next)
  })
}

export function setMotionReducedMotion(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  value: MotionReducedMotionChoice,
  label: string
): number {
  return updateExistingMotion(editor, nodeIds, label, (motion) => {
    const next = cloneMotionSpec(motion)
    if (value === 'default') delete next.reducedMotion
    else next.reducedMotion = value
    if (presetSelection(motion) === 'custom') delete next.preset
    return parseMotionSpec(next)
  })
}

export function setMotionPresetParameter(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  name: 'distance' | 'intensity',
  value: number,
  label: string
): number {
  return updateExistingMotion(editor, nodeIds, label, (motion) => {
    const presetId = presetSelection(motion)
    if (!presetId || presetId === 'custom') return motion
    const definition = MOTION_PRESET_REGISTRY[presetId]
    if (!definition.parameters[name]) return motion

    const parameters = Object.fromEntries(
      Object.entries(definition.parameters).map(([parameterName, rule]) => {
        const stored = motion.preset?.parameters[parameterName]
        return [parameterName, typeof stored === 'number' ? stored : rule.defaultValue]
      })
    )
    parameters[name] = value
    const next = createMotionPreset(presetId, parameters)

    const trigger = trackValue(motion, (track) => track.trigger)
    if (trigger !== MOTION_MIXED && trigger !== undefined) {
      for (const track of next.tracks) track.trigger = trigger
    }
    if (motion.reducedMotion === undefined) delete next.reducedMotion
    else next.reducedMotion = motion.reducedMotion
    return parseMotionSpec(next)
  })
}
