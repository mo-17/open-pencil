import { createMotionContractValidationHelpers } from './contract-validation'
import type { MotionEasing, MotionValidationIssue } from './types'
import { MOTION_LIMITS } from './types'
import { MotionValidationError, parseMotionEasing } from './validation'
import { assertMotionPortableValue, MotionIssueValidationError } from './validation-helpers'

export const PROTOTYPE_SPEC_VERSION = 1 as const

export const PROTOTYPE_LIMITS = Object.freeze({
  maxConnections: 16,
  afterDelayMs: MOTION_LIMITS.delayMs,
  durationMs: MOTION_LIMITS.durationMs
})

export type PrototypeTrigger = { kind: 'click' } | { kind: 'afterDelay'; delayMs: number }

export type PrototypeAction =
  | { kind: 'navigate'; targetNodeId: string }
  | { kind: 'back' }
  | {
      kind: 'openOverlay'
      targetNodeId: string
      placement: 'center' | 'top' | 'right' | 'bottom' | 'left'
      dismissOnOutside?: boolean
    }
  | { kind: 'closeOverlay' }

export type PrototypeTransitionDirection = 'left' | 'right' | 'up' | 'down'

interface TimedPrototypeTransition {
  durationMs: number
  easing: MotionEasing
}

export type PrototypeTransition =
  | { kind: 'instant' }
  | ({ kind: 'dissolve' } & TimedPrototypeTransition)
  | ({ kind: 'slide'; direction: PrototypeTransitionDirection } & TimedPrototypeTransition)
  | ({ kind: 'push'; direction: PrototypeTransitionDirection } & TimedPrototypeTransition)
  | ({
      kind: 'smartMatch'
      fallback: 'dissolve' | 'instant'
    } & TimedPrototypeTransition)

export interface PrototypeConnection {
  id: string
  trigger: PrototypeTrigger
  action: PrototypeAction
  transition: PrototypeTransition
  interruption?: 'replace' | 'queue'
  playback?: 'forward' | 'reverse'
}

/** Source-node prototype connections, independent from lowcode event/action chains. */
export interface PrototypeSpecV1 {
  version: typeof PROTOTYPE_SPEC_VERSION
  connections: PrototypeConnection[]
}

export type PrototypeValidationResult =
  | { success: true; value: PrototypeSpecV1 }
  | { success: false; issues: MotionValidationIssue[] }

export class PrototypeValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'PrototypeValidationError'
  }
}

const DIRECTIONS = new Set<PrototypeTransitionDirection>(['left', 'right', 'up', 'down'])
const OVERLAY_PLACEMENTS = new Set<Extract<PrototypeAction, { kind: 'openOverlay' }>['placement']>([
  'center',
  'top',
  'right',
  'bottom',
  'left'
])
const INTERRUPTIONS = new Set<NonNullable<PrototypeConnection['interruption']>>([
  'replace',
  'queue'
])
const PLAYBACK = new Set<NonNullable<PrototypeConnection['playback']>>(['forward', 'reverse'])
const SMART_MATCH_FALLBACKS = new Set<
  Extract<PrototypeTransition, { kind: 'smartMatch' }>['fallback']
>(['dissolve', 'instant'])

const {
  booleanValue,
  boundedNumber,
  enumValue,
  invalid,
  plainRecord,
  required,
  safeId,
  safeReference,
  strictRecord,
  uniqueIds
} = createMotionContractValidationHelpers((issues) => new PrototypeValidationError(issues))

function parsePrototypeEasing(value: unknown, path: string): MotionEasing {
  try {
    return parseMotionEasing(value, path, 2)
  } catch (error) {
    if (error instanceof MotionValidationError) {
      throw new PrototypeValidationError(error.issues)
    }
    throw error
  }
}

function parseTrigger(value: unknown, path: string): PrototypeTrigger {
  const candidate = plainRecord(value, path)
  const kind = required(candidate, 'kind', path)
  if (kind === 'click') {
    strictRecord(value, path, ['kind'])
    return { kind }
  }
  if (kind === 'afterDelay') {
    const record = strictRecord(value, path, ['kind', 'delayMs'])
    return {
      kind,
      delayMs: boundedNumber(
        required(record, 'delayMs', path),
        `${path}.delayMs`,
        PROTOTYPE_LIMITS.afterDelayMs.min,
        PROTOTYPE_LIMITS.afterDelayMs.max
      )
    }
  }
  return invalid(`${path}.kind`, 'invalid_value', 'Unknown prototype trigger')
}

function parseAction(value: unknown, path: string): PrototypeAction {
  const candidate = plainRecord(value, path)
  const kind = required(candidate, 'kind', path)
  switch (kind) {
    case 'navigate': {
      const record = strictRecord(value, path, ['kind', 'targetNodeId'])
      return {
        kind,
        targetNodeId: safeReference(required(record, 'targetNodeId', path), `${path}.targetNodeId`)
      }
    }
    case 'back':
    case 'closeOverlay':
      strictRecord(value, path, ['kind'])
      return { kind }
    case 'openOverlay': {
      const record = strictRecord(value, path, [
        'kind',
        'targetNodeId',
        'placement',
        'dismissOnOutside'
      ])
      const action: Extract<PrototypeAction, { kind: 'openOverlay' }> = {
        kind,
        targetNodeId: safeReference(required(record, 'targetNodeId', path), `${path}.targetNodeId`),
        placement: enumValue(
          required(record, 'placement', path),
          `${path}.placement`,
          OVERLAY_PLACEMENTS,
          'overlay placement'
        )
      }
      if (Object.hasOwn(record, 'dismissOnOutside')) {
        action.dismissOnOutside = booleanValue(record.dismissOnOutside, `${path}.dismissOnOutside`)
      }
      return action
    }
    default:
      return invalid(`${path}.kind`, 'invalid_value', 'Unknown prototype action')
  }
}

function timedTransition(record: Record<string, unknown>, path: string): TimedPrototypeTransition {
  return {
    durationMs: boundedNumber(
      required(record, 'durationMs', path),
      `${path}.durationMs`,
      PROTOTYPE_LIMITS.durationMs.min,
      PROTOTYPE_LIMITS.durationMs.max
    ),
    easing: parsePrototypeEasing(required(record, 'easing', path), `${path}.easing`)
  }
}

function parseTransition(value: unknown, path: string): PrototypeTransition {
  const candidate = plainRecord(value, path)
  const kind = required(candidate, 'kind', path)
  switch (kind) {
    case 'instant':
      strictRecord(value, path, ['kind'])
      return { kind }
    case 'dissolve': {
      const record = strictRecord(value, path, ['kind', 'durationMs', 'easing'])
      return { kind, ...timedTransition(record, path) }
    }
    case 'slide':
    case 'push': {
      const record = strictRecord(value, path, ['kind', 'durationMs', 'easing', 'direction'])
      return {
        kind,
        ...timedTransition(record, path),
        direction: enumValue(
          required(record, 'direction', path),
          `${path}.direction`,
          DIRECTIONS,
          'transition direction'
        )
      }
    }
    case 'smartMatch': {
      const record = strictRecord(value, path, ['kind', 'durationMs', 'easing', 'fallback'])
      return {
        kind,
        ...timedTransition(record, path),
        fallback: enumValue(
          required(record, 'fallback', path),
          `${path}.fallback`,
          SMART_MATCH_FALLBACKS,
          'Smart Match fallback'
        )
      }
    }
    default:
      return invalid(`${path}.kind`, 'invalid_value', 'Unknown prototype transition')
  }
}

function parseConnection(value: unknown, path: string): PrototypeConnection {
  const record = strictRecord(value, path, [
    'id',
    'trigger',
    'action',
    'transition',
    'interruption',
    'playback'
  ])
  const connection: PrototypeConnection = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    trigger: parseTrigger(required(record, 'trigger', path), `${path}.trigger`),
    action: parseAction(required(record, 'action', path), `${path}.action`),
    transition: parseTransition(required(record, 'transition', path), `${path}.transition`)
  }
  if (Object.hasOwn(record, 'interruption')) {
    connection.interruption = enumValue(
      record.interruption,
      `${path}.interruption`,
      INTERRUPTIONS,
      'interruption policy'
    )
  }
  if (Object.hasOwn(record, 'playback')) {
    connection.playback = enumValue(
      record.playback,
      `${path}.playback`,
      PLAYBACK,
      'transition playback'
    )
  }
  return connection
}

/** Parse a fresh canonical, bounded source-node prototype snapshot. */
export function parsePrototypeSpec(value: unknown): PrototypeSpecV1 {
  assertMotionPortableValue(value, 'prototype', { invalid, plainRecord })
  const record = strictRecord(value, 'prototype', ['version', 'connections'])
  if (required(record, 'version', 'prototype') !== PROTOTYPE_SPEC_VERSION) {
    return invalid('prototype.version', 'invalid_value', 'Unsupported prototype version')
  }
  const rawConnections = required(record, 'connections', 'prototype')
  if (!Array.isArray(rawConnections)) {
    return invalid('prototype.connections', 'invalid_type', 'Expected an array')
  }
  if (rawConnections.length < 1 || rawConnections.length > PROTOTYPE_LIMITS.maxConnections) {
    return invalid(
      'prototype.connections',
      'limit_exceeded',
      `Expected between 1 and ${PROTOTYPE_LIMITS.maxConnections} connections`
    )
  }
  const connections = rawConnections.map((connection, index) =>
    parseConnection(connection, `prototype.connections[${index}]`)
  )
  uniqueIds(connections, 'prototype.connections', 'Connection')
  return { version: PROTOTYPE_SPEC_VERSION, connections }
}

export function validatePrototypeSpec(value: unknown): PrototypeValidationResult {
  try {
    return { success: true, value: parsePrototypeSpec(value) }
  } catch (error) {
    if (error instanceof PrototypeValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

function cloneTransition(transition: PrototypeTransition): PrototypeTransition {
  if (transition.kind === 'instant') return { ...transition }
  const easing =
    typeof transition.easing === 'string' ? transition.easing : { ...transition.easing }
  return { ...transition, easing }
}

export function clonePrototypeSpec(value: PrototypeSpecV1): PrototypeSpecV1 {
  return parsePrototypeSpec({
    version: value.version,
    connections: value.connections.map((connection) => ({
      ...connection,
      trigger: { ...connection.trigger },
      action: { ...connection.action },
      transition: cloneTransition(connection.transition)
    }))
  })
}

export type PrototypeNodeIdResolver = (nodeId: string) => string | undefined

function remapAction(
  action: PrototypeAction,
  resolveNodeId: PrototypeNodeIdResolver
): PrototypeAction {
  if (action.kind === 'navigate' || action.kind === 'openOverlay') {
    return { ...action, targetNodeId: resolveNodeId(action.targetNodeId) ?? action.targetNodeId }
  }
  return { ...action }
}

/** Remap destination node references while preserving connection identities and order. */
export function remapPrototypeNodeReferences(
  value: PrototypeSpecV1,
  resolveNodeId: PrototypeNodeIdResolver
): PrototypeSpecV1 {
  const spec = parsePrototypeSpec(value)
  return parsePrototypeSpec({
    ...spec,
    connections: spec.connections.map((connection) => ({
      ...connection,
      action: remapAction(connection.action, resolveNodeId)
    }))
  })
}

export function remapPrototypeNodeIds(
  value: PrototypeSpecV1,
  remap: ReadonlyMap<string, string>
): PrototypeSpecV1 {
  return remapPrototypeNodeReferences(value, (nodeId) => remap.get(nodeId))
}

export function prototypeNodeReferences(value: PrototypeSpecV1): string[] {
  return parsePrototypeSpec(value).connections.flatMap(({ action }) =>
    action.kind === 'navigate' || action.kind === 'openOverlay' ? [action.targetNodeId] : []
  )
}
