import { createMotionContractValidationHelpers } from './contract-validation'
import type { MotionValidationIssue } from './types'
import { assertMotionPortableValue, MotionIssueValidationError } from './validation-helpers'

export const MOTION_DRIVER_SPEC_VERSION = 1 as const

export const MOTION_DRIVER_LIMITS = Object.freeze({
  maxDrivers: 64,
  input: Object.freeze({ min: -1_000_000, max: 1_000_000 }),
  dragDistance: Object.freeze({ min: 1, max: 100_000 }),
  deadZone: Object.freeze({ min: 0, max: 0.49 })
})

export type MotionDriverAxis = 'x' | 'y'

export type MotionDriverSource =
  | {
      kind: 'scroll'
      sourceNodeId?: string
      axis: MotionDriverAxis
      metric: 'progress' | 'offset'
    }
  | {
      kind: 'pointer'
      sourceNodeId?: string
      axis: MotionDriverAxis
      space: 'local' | 'viewport'
    }
  | { kind: 'drag'; handleNodeId: string; axis: MotionDriverAxis; distance: number }
  | { kind: 'visibility'; sourceNodeId: string }
  | { kind: 'pageState'; stateId: string }
  | { kind: 'documentState'; stateId: string }
  | { kind: 'variable'; variableId: string }

export interface MotionDriverTarget {
  targetNodeId: string
  trackId: string
}

export interface MotionDriverMapping {
  inputMin: number
  inputMax: number
  /** Clamp normalized progress to 0..1. Runtime default is true. */
  clamp?: boolean
  reverse?: boolean
  /** Ignore normalized movement around either endpoint. */
  deadZone?: number
}

export interface MotionDriver {
  id: string
  source: MotionDriverSource
  target: MotionDriverTarget
  mapping: MotionDriverMapping
}

/** Page/frame-scoped continuous inputs referencing node-local Motion tracks. */
export interface MotionDriverSpecV1 {
  version: typeof MOTION_DRIVER_SPEC_VERSION
  drivers: MotionDriver[]
}

export type MotionDriverValidationResult =
  | { success: true; value: MotionDriverSpecV1 }
  | { success: false; issues: MotionValidationIssue[] }

export class MotionDriverValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'MotionDriverValidationError'
  }
}

const AXES = new Set<MotionDriverAxis>(['x', 'y'])
const SCROLL_METRICS = new Set<Extract<MotionDriverSource, { kind: 'scroll' }>['metric']>([
  'progress',
  'offset'
])
const POINTER_SPACES = new Set<Extract<MotionDriverSource, { kind: 'pointer' }>['space']>([
  'local',
  'viewport'
])

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
} = createMotionContractValidationHelpers((issues) => new MotionDriverValidationError(issues))

function optionalNodeReference(
  record: Record<string, unknown>,
  key: string,
  path: string
): string | undefined {
  return Object.hasOwn(record, key) ? safeReference(record[key], `${path}.${key}`) : undefined
}

function parseSpatialSourceBase(value: unknown, path: string, detailKey: 'metric' | 'space') {
  const record = strictRecord(value, path, ['kind', 'sourceNodeId', 'axis', detailKey])
  return {
    record,
    sourceNodeId: optionalNodeReference(record, 'sourceNodeId', path),
    axis: enumValue(required(record, 'axis', path), `${path}.axis`, AXES, 'driver axis')
  }
}

function parseSource(value: unknown, path: string): MotionDriverSource {
  const candidate = plainRecord(value, path)
  const kind = required(candidate, 'kind', path)
  if (typeof kind !== 'string') return invalid(`${path}.kind`, 'invalid_type', 'Expected a string')

  switch (kind) {
    case 'scroll': {
      const { record, sourceNodeId, axis } = parseSpatialSourceBase(value, path, 'metric')
      return {
        kind,
        ...(sourceNodeId ? { sourceNodeId } : {}),
        axis,
        metric: enumValue(
          required(record, 'metric', path),
          `${path}.metric`,
          SCROLL_METRICS,
          'scroll metric'
        )
      }
    }
    case 'pointer': {
      const { record, sourceNodeId, axis } = parseSpatialSourceBase(value, path, 'space')
      return {
        kind,
        ...(sourceNodeId ? { sourceNodeId } : {}),
        axis,
        space: enumValue(
          required(record, 'space', path),
          `${path}.space`,
          POINTER_SPACES,
          'pointer space'
        )
      }
    }
    case 'drag': {
      const record = strictRecord(value, path, ['kind', 'handleNodeId', 'axis', 'distance'])
      return {
        kind,
        handleNodeId: safeReference(required(record, 'handleNodeId', path), `${path}.handleNodeId`),
        axis: enumValue(required(record, 'axis', path), `${path}.axis`, AXES, 'driver axis'),
        distance: boundedNumber(
          required(record, 'distance', path),
          `${path}.distance`,
          MOTION_DRIVER_LIMITS.dragDistance.min,
          MOTION_DRIVER_LIMITS.dragDistance.max
        )
      }
    }
    case 'visibility': {
      const record = strictRecord(value, path, ['kind', 'sourceNodeId'])
      return {
        kind,
        sourceNodeId: safeReference(required(record, 'sourceNodeId', path), `${path}.sourceNodeId`)
      }
    }
    case 'pageState':
    case 'documentState': {
      const record = strictRecord(value, path, ['kind', 'stateId'])
      return {
        kind,
        stateId: safeReference(required(record, 'stateId', path), `${path}.stateId`)
      }
    }
    case 'variable': {
      const record = strictRecord(value, path, ['kind', 'variableId'])
      return {
        kind,
        variableId: safeReference(required(record, 'variableId', path), `${path}.variableId`)
      }
    }
    default:
      return invalid(`${path}.kind`, 'invalid_value', 'Unknown Motion driver source')
  }
}

function parseTarget(value: unknown, path: string): MotionDriverTarget {
  const record = strictRecord(value, path, ['targetNodeId', 'trackId'])
  return {
    targetNodeId: safeReference(required(record, 'targetNodeId', path), `${path}.targetNodeId`),
    trackId: safeId(required(record, 'trackId', path), `${path}.trackId`)
  }
}

function parseMapping(value: unknown, path: string): MotionDriverMapping {
  const record = strictRecord(value, path, ['inputMin', 'inputMax', 'clamp', 'reverse', 'deadZone'])
  const mapping: MotionDriverMapping = {
    inputMin: boundedNumber(
      required(record, 'inputMin', path),
      `${path}.inputMin`,
      MOTION_DRIVER_LIMITS.input.min,
      MOTION_DRIVER_LIMITS.input.max
    ),
    inputMax: boundedNumber(
      required(record, 'inputMax', path),
      `${path}.inputMax`,
      MOTION_DRIVER_LIMITS.input.min,
      MOTION_DRIVER_LIMITS.input.max
    )
  }
  if (mapping.inputMax <= mapping.inputMin) {
    return invalid(`${path}.inputMax`, 'invalid_value', 'inputMax must be greater than inputMin')
  }
  if (Object.hasOwn(record, 'clamp')) {
    mapping.clamp = booleanValue(record.clamp, `${path}.clamp`)
  }
  if (Object.hasOwn(record, 'reverse')) {
    mapping.reverse = booleanValue(record.reverse, `${path}.reverse`)
  }
  if (Object.hasOwn(record, 'deadZone')) {
    mapping.deadZone = boundedNumber(
      record.deadZone,
      `${path}.deadZone`,
      MOTION_DRIVER_LIMITS.deadZone.min,
      MOTION_DRIVER_LIMITS.deadZone.max
    )
  }
  return mapping
}

function parseDriver(value: unknown, path: string): MotionDriver {
  const record = strictRecord(value, path, ['id', 'source', 'target', 'mapping'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    source: parseSource(required(record, 'source', path), `${path}.source`),
    target: parseTarget(required(record, 'target', path), `${path}.target`),
    mapping: parseMapping(required(record, 'mapping', path), `${path}.mapping`)
  }
}

function assertUniqueTargets(drivers: readonly MotionDriver[]): void {
  const targets = new Set<string>()
  for (let index = 0; index < drivers.length; index++) {
    const target = drivers[index].target
    const key = `${target.targetNodeId}\u0000${target.trackId}`
    if (targets.has(key)) {
      invalid(
        `motionDrivers.drivers[${index}].target`,
        'invalid_value',
        'A Motion track may have at most one driver in a driver spec'
      )
    }
    targets.add(key)
  }
}

/** Parse a fresh canonical, bounded continuous-driver snapshot. */
export function parseMotionDriverSpec(value: unknown): MotionDriverSpecV1 {
  assertMotionPortableValue(value, 'motionDrivers', { invalid, plainRecord })
  const record = strictRecord(value, 'motionDrivers', ['version', 'drivers'])
  if (required(record, 'version', 'motionDrivers') !== MOTION_DRIVER_SPEC_VERSION) {
    return invalid('motionDrivers.version', 'invalid_value', 'Unsupported Motion driver version')
  }
  const rawDrivers = required(record, 'drivers', 'motionDrivers')
  if (!Array.isArray(rawDrivers)) {
    return invalid('motionDrivers.drivers', 'invalid_type', 'Expected an array')
  }
  if (rawDrivers.length < 1 || rawDrivers.length > MOTION_DRIVER_LIMITS.maxDrivers) {
    return invalid(
      'motionDrivers.drivers',
      'limit_exceeded',
      `Expected between 1 and ${MOTION_DRIVER_LIMITS.maxDrivers} drivers`
    )
  }
  const drivers = rawDrivers.map((driver, index) =>
    parseDriver(driver, `motionDrivers.drivers[${index}]`)
  )
  uniqueIds(drivers, 'motionDrivers.drivers', 'Driver')
  assertUniqueTargets(drivers)
  return { version: MOTION_DRIVER_SPEC_VERSION, drivers }
}

export function validateMotionDriverSpec(value: unknown): MotionDriverValidationResult {
  try {
    return { success: true, value: parseMotionDriverSpec(value) }
  } catch (error) {
    if (error instanceof MotionDriverValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function cloneMotionDriverSpec(value: MotionDriverSpecV1): MotionDriverSpecV1 {
  return parseMotionDriverSpec({
    version: value.version,
    drivers: value.drivers.map((driver) => ({
      ...driver,
      source: { ...driver.source },
      target: { ...driver.target },
      mapping: { ...driver.mapping }
    }))
  })
}

export type MotionDriverNodeIdResolver = (nodeId: string) => string | undefined

function unreachableDriverSource(source: never): never {
  return invalid(
    'motionDrivers.drivers.source.kind',
    'invalid_value',
    `Unsupported Motion driver source: ${String(source)}`
  )
}

function remapSource(
  source: MotionDriverSource,
  resolveNodeId: MotionDriverNodeIdResolver
): MotionDriverSource {
  switch (source.kind) {
    case 'scroll':
    case 'pointer':
      return source.sourceNodeId
        ? { ...source, sourceNodeId: resolveNodeId(source.sourceNodeId) ?? source.sourceNodeId }
        : { ...source }
    case 'drag':
      return { ...source, handleNodeId: resolveNodeId(source.handleNodeId) ?? source.handleNodeId }
    case 'visibility':
      return { ...source, sourceNodeId: resolveNodeId(source.sourceNodeId) ?? source.sourceNodeId }
    case 'pageState':
    case 'documentState':
    case 'variable':
      return { ...source }
  }
  return unreachableDriverSource(source)
}

/** Remap only node references; state, variable, driver, and track identities remain stable. */
export function remapMotionDriverNodeReferences(
  value: MotionDriverSpecV1,
  resolveNodeId: MotionDriverNodeIdResolver
): MotionDriverSpecV1 {
  const spec = parseMotionDriverSpec(value)
  return parseMotionDriverSpec({
    ...spec,
    drivers: spec.drivers.map((driver) => ({
      ...driver,
      source: remapSource(driver.source, resolveNodeId),
      target: {
        ...driver.target,
        targetNodeId: resolveNodeId(driver.target.targetNodeId) ?? driver.target.targetNodeId
      }
    }))
  })
}

export function remapMotionDriverNodeIds(
  value: MotionDriverSpecV1,
  remap: ReadonlyMap<string, string>
): MotionDriverSpecV1 {
  return remapMotionDriverNodeReferences(value, (nodeId) => remap.get(nodeId))
}

export function motionDriverNodeReferences(value: MotionDriverSpecV1): string[] {
  const spec = parseMotionDriverSpec(value)
  const references: string[] = []
  for (const driver of spec.drivers) {
    references.push(driver.target.targetNodeId)
    if (driver.source.kind === 'scroll' || driver.source.kind === 'pointer') {
      if (driver.source.sourceNodeId) references.push(driver.source.sourceNodeId)
    } else if (driver.source.kind === 'drag') {
      references.push(driver.source.handleNodeId)
    } else if (driver.source.kind === 'visibility') {
      references.push(driver.source.sourceNodeId)
    }
  }
  return references
}
