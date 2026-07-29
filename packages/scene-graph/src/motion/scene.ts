import { createMotionContractValidationHelpers } from './contract-validation'
import type { MotionValidationIssue } from './types'
import { assertMotionPortableValue, MotionIssueValidationError } from './validation-helpers'

export const MOTION_SCENE_VERSION = 1 as const

export const MOTION_SCENE_LIMITS = Object.freeze({
  maxSequences: 16,
  maxCuesPerSequence: 512,
  maxMarkersPerSequence: 128,
  maxTotalCues: 2_048,
  maxIdLength: 64,
  maxNodeReferenceLength: 128,
  maxNameLength: 96,
  maxMarkerLabelLength: 96,
  timeMs: Object.freeze({ min: 0, max: 3_600_000 }),
  timeScale: Object.freeze({ min: 0.01, max: 100 })
})

export type MotionSceneTrigger = 'pageEnter' | 'pageExit' | 'manual'

export interface MotionSceneCue {
  id: string
  targetNodeId: string
  trackId: string
  startMs: number
  timeScale?: number
  enabled?: boolean
}

export interface MotionSceneMarker {
  id: string
  timeMs: number
  label: string
}

export interface MotionSceneSequence {
  id: string
  name?: string
  trigger: MotionSceneTrigger
  cues: MotionSceneCue[]
  markers?: MotionSceneMarker[]
}

/**
 * Page/frame choreography references node-local Motion tracks without duplicating keyframes.
 * The node MotionSpec remains authoritative; this structure owns only timing and grouping.
 */
export interface MotionSceneSpec {
  version: typeof MOTION_SCENE_VERSION
  id: string
  sequences: MotionSceneSequence[]
}

export type MotionSceneValidationResult =
  | { success: true; value: MotionSceneSpec }
  | { success: false; issues: MotionValidationIssue[] }

export class MotionSceneValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'MotionSceneValidationError'
  }
}

const TRIGGERS = new Set<MotionSceneTrigger>(['pageEnter', 'pageExit', 'manual'])

const {
  boundedNumber,
  invalid,
  plainRecord,
  required,
  safeId,
  safeNodeReference: nodeReference,
  strictRecord,
  text: normalizedText
} = createMotionContractValidationHelpers((issues) => new MotionSceneValidationError(issues))

function text(value: unknown, path: string, max: number): string {
  return normalizedText(value, path, 1, max)
}

function parseCue(value: unknown, path: string): MotionSceneCue {
  const record = strictRecord(value, path, [
    'id',
    'targetNodeId',
    'trackId',
    'startMs',
    'timeScale',
    'enabled'
  ])
  const cue: MotionSceneCue = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    targetNodeId: nodeReference(required(record, 'targetNodeId', path), `${path}.targetNodeId`),
    trackId: safeId(required(record, 'trackId', path), `${path}.trackId`),
    startMs: boundedNumber(
      required(record, 'startMs', path),
      `${path}.startMs`,
      MOTION_SCENE_LIMITS.timeMs.min,
      MOTION_SCENE_LIMITS.timeMs.max
    )
  }
  if (Object.hasOwn(record, 'timeScale')) {
    cue.timeScale = boundedNumber(
      record.timeScale,
      `${path}.timeScale`,
      MOTION_SCENE_LIMITS.timeScale.min,
      MOTION_SCENE_LIMITS.timeScale.max
    )
  }
  if (Object.hasOwn(record, 'enabled')) {
    if (typeof record.enabled !== 'boolean') {
      return invalid(`${path}.enabled`, 'invalid_type', 'Expected a boolean')
    }
    cue.enabled = record.enabled
  }
  return cue
}

function parseMarker(value: unknown, path: string): MotionSceneMarker {
  const record = strictRecord(value, path, ['id', 'timeMs', 'label'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    timeMs: boundedNumber(
      required(record, 'timeMs', path),
      `${path}.timeMs`,
      MOTION_SCENE_LIMITS.timeMs.min,
      MOTION_SCENE_LIMITS.timeMs.max
    ),
    label: text(
      required(record, 'label', path),
      `${path}.label`,
      MOTION_SCENE_LIMITS.maxMarkerLabelLength
    )
  }
}

function uniqueIds(values: readonly { id: string }[], path: string, label: string): void {
  const ids = new Set<string>()
  for (let index = 0; index < values.length; index++) {
    const id = values[index].id
    if (ids.has(id)) invalid(`${path}[${index}].id`, 'invalid_value', `${label} ids must be unique`)
    ids.add(id)
  }
}

function parseSequence(value: unknown, path: string): MotionSceneSequence {
  const record = strictRecord(value, path, ['id', 'name', 'trigger', 'cues', 'markers'])
  const trigger = required(record, 'trigger', path)
  if (typeof trigger !== 'string' || !TRIGGERS.has(trigger as MotionSceneTrigger)) {
    return invalid(`${path}.trigger`, 'invalid_value', 'Unknown scene trigger')
  }
  const rawCues = required(record, 'cues', path)
  if (!Array.isArray(rawCues)) return invalid(`${path}.cues`, 'invalid_type', 'Expected an array')
  if (rawCues.length > MOTION_SCENE_LIMITS.maxCuesPerSequence) {
    return invalid(
      `${path}.cues`,
      'limit_exceeded',
      `A sequence may contain at most ${MOTION_SCENE_LIMITS.maxCuesPerSequence} cues`
    )
  }
  const cues = rawCues.map((cue, index) => parseCue(cue, `${path}.cues[${index}]`))
  uniqueIds(cues, `${path}.cues`, 'Cue')

  const sequence: MotionSceneSequence = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    trigger: trigger as MotionSceneTrigger,
    cues
  }
  if (Object.hasOwn(record, 'name')) {
    sequence.name = text(record.name, `${path}.name`, MOTION_SCENE_LIMITS.maxNameLength)
  }
  if (Object.hasOwn(record, 'markers')) {
    if (!Array.isArray(record.markers)) {
      return invalid(`${path}.markers`, 'invalid_type', 'Expected an array')
    }
    if (record.markers.length > MOTION_SCENE_LIMITS.maxMarkersPerSequence) {
      return invalid(
        `${path}.markers`,
        'limit_exceeded',
        `A sequence may contain at most ${MOTION_SCENE_LIMITS.maxMarkersPerSequence} markers`
      )
    }
    const markers = record.markers.map((marker, index) =>
      parseMarker(marker, `${path}.markers[${index}]`)
    )
    uniqueIds(markers, `${path}.markers`, 'Marker')
    for (let index = 1; index < markers.length; index++) {
      if (markers[index].timeMs < markers[index - 1].timeMs) {
        return invalid(
          `${path}.markers[${index}].timeMs`,
          'invalid_value',
          'Markers must be ordered by time'
        )
      }
    }
    sequence.markers = markers
  }
  return sequence
}

/** Parse and return a fresh, canonical page/frame choreography snapshot. */
export function parseMotionSceneSpec(value: unknown): MotionSceneSpec {
  assertMotionPortableValue(value, 'motionScene', { invalid, plainRecord })
  const record = strictRecord(value, 'motionScene', ['version', 'id', 'sequences'])
  if (required(record, 'version', 'motionScene') !== MOTION_SCENE_VERSION) {
    return invalid('motionScene.version', 'invalid_value', 'Unsupported Motion scene version')
  }
  const rawSequences = required(record, 'sequences', 'motionScene')
  if (!Array.isArray(rawSequences)) {
    return invalid('motionScene.sequences', 'invalid_type', 'Expected an array')
  }
  if (rawSequences.length < 1 || rawSequences.length > MOTION_SCENE_LIMITS.maxSequences) {
    return invalid(
      'motionScene.sequences',
      'limit_exceeded',
      `Expected between 1 and ${MOTION_SCENE_LIMITS.maxSequences} sequences`
    )
  }
  const sequences = rawSequences.map((sequence, index) =>
    parseSequence(sequence, `motionScene.sequences[${index}]`)
  )
  uniqueIds(sequences, 'motionScene.sequences', 'Sequence')
  const totalCues = sequences.reduce((sum, sequence) => sum + sequence.cues.length, 0)
  if (totalCues > MOTION_SCENE_LIMITS.maxTotalCues) {
    return invalid(
      'motionScene.sequences',
      'limit_exceeded',
      `A scene may contain at most ${MOTION_SCENE_LIMITS.maxTotalCues} cues`
    )
  }
  return {
    version: MOTION_SCENE_VERSION,
    id: safeId(required(record, 'id', 'motionScene'), 'motionScene.id'),
    sequences
  }
}

export function validateMotionSceneSpec(value: unknown): MotionSceneValidationResult {
  try {
    return { success: true, value: parseMotionSceneSpec(value) }
  } catch (error) {
    if (error instanceof MotionSceneValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function cloneMotionSceneSpec(value: MotionSceneSpec): MotionSceneSpec {
  const cloned = structuredClone(value)
  return parseMotionSceneSpec(cloned)
}

export type MotionSceneNodeIdResolver = (nodeId: string) => string | undefined

/** Remap node references while preserving sequence/cue identities and ordering. */
export function remapMotionSceneNodeReferences(
  value: MotionSceneSpec,
  resolveNodeId: MotionSceneNodeIdResolver
): MotionSceneSpec {
  const scene = parseMotionSceneSpec(value)
  return parseMotionSceneSpec({
    ...scene,
    sequences: scene.sequences.map((sequence) => ({
      ...sequence,
      cues: sequence.cues.map((cue) => ({
        ...cue,
        targetNodeId: resolveNodeId(cue.targetNodeId) ?? cue.targetNodeId
      }))
    }))
  })
}

export function remapMotionSceneNodeIds(
  value: MotionSceneSpec,
  remap: ReadonlyMap<string, string>
): MotionSceneSpec {
  return remapMotionSceneNodeReferences(value, (nodeId) => remap.get(nodeId))
}
