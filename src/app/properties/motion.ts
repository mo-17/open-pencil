import {
  cloneMotionSpec,
  createMotionPreset,
  expandMotionPreset,
  isMotionPresetId,
  MOTION_PRESET_REGISTRY,
  parseMotionSpec,
  type MotionPresetId,
  type MotionPresetParameterName,
  type MotionSpec,
  type MotionTrigger,
  type SceneNode
} from '@open-pencil/scene-graph'

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
  }
  undo: {
    runBatch<T>(label: string, apply: () => T, coalesceKey?: string): T
  }
  updateNodeWithUndo(id: string, changes: Partial<SceneNode>, label?: string): void
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
    if (!sameMotion(node.motion, motion)) updates.push({ id, motion })
  }
  if (updates.length === 0) return 0

  editor.undo.runBatch(label, () => {
    for (const update of updates) {
      editor.updateNodeWithUndo(update.id, { motion: update.motion }, label)
    }
  })
  return updates.length
}

export function applyMotionPreset(
  editor: MotionMutationEditor,
  nodeIds: readonly string[],
  presetId: MotionPresetId,
  label: string
): number {
  const preset = createMotionPreset(presetId)
  return mutateSelectedMotion(editor, nodeIds, label, () => cloneMotionSpec(preset))
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
    if (next.preset && Object.hasOwn(next.preset.parameters, field)) {
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
