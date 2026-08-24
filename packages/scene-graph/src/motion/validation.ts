import { getMotionChannels } from './channels'
import { cloneMotionKeyframe, cloneMotionPath } from './clone'
import {
  MOTION_LIMITS,
  type MotionCornerRadii,
  type MotionColor,
  type MotionDirection,
  type MotionEaseMode,
  type MotionEasing,
  type MotionEasingName,
  type MotionEffectTarget,
  type MotionFill,
  type MotionFontAxisTarget,
  type MotionGradientStopTarget,
  type MotionKeyframe,
  type MotionPaintKind,
  type MotionPaintTarget,
  type MotionPath,
  type MotionPathPoint,
  type MotionPresetProvenance,
  type MotionSpec,
  type MotionTiming,
  type MotionTrack,
  type MotionTrackComposition,
  type MotionTrigger,
  type MotionValidationIssue,
  type MotionValidationResult,
  type MotionVectorMorph
} from './types'
import { createMotionValidationHelpers, MotionIssueValidationError } from './validation-helpers'

export class MotionValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'MotionValidationError'
  }
}

const TRIGGERS: readonly MotionTrigger[] = [
  'mount',
  'pageEnter',
  'pageExit',
  'hover',
  'press',
  'focus',
  'click',
  'inView',
  'loop'
]
const EASING_NAMES: readonly MotionEasingName[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out'
]
const EASE_MODES: readonly MotionEaseMode[] = ['in', 'out', 'inOut']
const DIRECTIONS: readonly MotionDirection[] = [
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse'
]
const FILLS: readonly MotionFill[] = ['none', 'forwards', 'backwards', 'both']
const EXITS = ['none', 'reverse', 'reset'] as const
const REDUCED_MOTION = ['reduce', 'disable', 'allow'] as const
const COMPOSITE_MODES: readonly MotionTrackComposition['mode'][] = ['replace', 'add', 'accumulate']
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const SAFE_PARAMETER_STRING = /^[\p{L}\p{N} _.-]{0,128}$/u
const SAFE_TOPOLOGY_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/
const FONT_AXIS_TAG = /^[A-Za-z0-9]{4}$/
const DANGEROUS_IDS = new Set(['constructor', 'prototype', '__proto__', 'javascript'])
const MAX_TRACK_NAME_LENGTH = 128
const COMPOSABLE_CHANNELS = new Set(['opacity', 'translate', 'scale', 'rotate'])
const PAINT_KINDS: readonly MotionPaintKind[] = ['fill', 'stroke']

const { invalid, plainRecord, required, strictRecord } = createMotionValidationHelpers(
  (issues) => new MotionValidationError(issues)
)

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number') return invalid(path, 'invalid_type', 'Expected a number')
  if (!Number.isFinite(value)) return invalid(path, 'invalid_value', 'Expected a finite number')
  return Object.is(value, -0) ? 0 : value
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  const number = finiteNumber(value, path)
  if (number < min || number > max) {
    return invalid(path, 'out_of_range', `Expected a value from ${min} to ${max}`)
  }
  return number
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const number = boundedNumber(value, path, min, max)
  if (!Number.isInteger(number)) return invalid(path, 'invalid_value', 'Expected an integer')
  return number
}

function easeMode(value: unknown, path: string): MotionEaseMode {
  if (!isOneOf(value, EASE_MODES)) {
    return invalid(path, 'invalid_value', 'Expected in, out, or inOut')
  }
  return value
}

function safeId(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'invalid_type', 'Expected an identifier')
  if (!SAFE_ID.test(value) || DANGEROUS_IDS.has(value.toLowerCase())) {
    return invalid(
      path,
      'invalid_value',
      `Expected a safe identifier of at most ${MOTION_LIMITS.maxIdLength} characters`
    )
  }
  return value
}

function trackName(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'invalid_type', 'Expected a string')
  const name = value.trim().normalize('NFC')
  if (name.length < 1 || name.length > MAX_TRACK_NAME_LENGTH || /\p{Cc}/u.test(name)) {
    return invalid(
      path,
      'invalid_value',
      `Expected a non-empty display name of at most ${MAX_TRACK_NAME_LENGTH} characters`
    )
  }
  return name
}

export function parseMotionEasing(
  value: unknown,
  path: string,
  version: MotionSpec['version']
): MotionEasing {
  if (typeof value === 'string') {
    if (!isOneOf(value, EASING_NAMES)) return invalid(path, 'invalid_value', 'Unknown easing')
    return value
  }
  const raw = plainRecord(value, path)
  const type = required(raw, 'type', path)
  if (type === 'cubicBezier') {
    const record = strictRecord(value, path, ['type', 'x1', 'y1', 'x2', 'y2'])
    return {
      type: 'cubicBezier',
      x1: boundedNumber(required(record, 'x1', path), `${path}.x1`, 0, 1),
      y1: boundedNumber(
        required(record, 'y1', path),
        `${path}.y1`,
        MOTION_LIMITS.cubicBezierY.min,
        MOTION_LIMITS.cubicBezierY.max
      ),
      x2: boundedNumber(required(record, 'x2', path), `${path}.x2`, 0, 1),
      y2: boundedNumber(
        required(record, 'y2', path),
        `${path}.y2`,
        MOTION_LIMITS.cubicBezierY.min,
        MOTION_LIMITS.cubicBezierY.max
      )
    }
  }
  if (version === 1) {
    return invalid(`${path}.type`, 'invalid_value', 'MotionSpec v1 only supports cubicBezier')
  }
  if (type === 'hold') {
    strictRecord(value, path, ['type'])
    return { type: 'hold' }
  }
  if (type === 'steps') {
    const record = strictRecord(value, path, ['type', 'steps', 'position'])
    const position = required(record, 'position', path)
    if (position !== 'start' && position !== 'end') {
      return invalid(`${path}.position`, 'invalid_value', 'Expected start or end')
    }
    return {
      type: 'steps',
      steps: integer(
        required(record, 'steps', path),
        `${path}.steps`,
        MOTION_LIMITS.steps.min,
        MOTION_LIMITS.steps.max
      ),
      position
    }
  }
  if (type === 'spring') {
    const record = strictRecord(value, path, ['type', 'mass', 'stiffness', 'damping', 'velocity'])
    return {
      type: 'spring',
      mass: boundedNumber(
        required(record, 'mass', path),
        `${path}.mass`,
        MOTION_LIMITS.springMass.min,
        MOTION_LIMITS.springMass.max
      ),
      stiffness: boundedNumber(
        required(record, 'stiffness', path),
        `${path}.stiffness`,
        MOTION_LIMITS.springStiffness.min,
        MOTION_LIMITS.springStiffness.max
      ),
      damping: boundedNumber(
        required(record, 'damping', path),
        `${path}.damping`,
        MOTION_LIMITS.springDamping.min,
        MOTION_LIMITS.springDamping.max
      ),
      velocity: boundedNumber(
        required(record, 'velocity', path),
        `${path}.velocity`,
        MOTION_LIMITS.physicalVelocity.min,
        MOTION_LIMITS.physicalVelocity.max
      )
    }
  }
  if (type === 'inertia') {
    const record = strictRecord(value, path, ['type', 'velocity', 'deceleration'])
    return {
      type: 'inertia',
      velocity: boundedNumber(
        required(record, 'velocity', path),
        `${path}.velocity`,
        MOTION_LIMITS.physicalVelocity.min,
        MOTION_LIMITS.physicalVelocity.max
      ),
      deceleration: boundedNumber(
        required(record, 'deceleration', path),
        `${path}.deceleration`,
        MOTION_LIMITS.inertiaDeceleration.min,
        MOTION_LIMITS.inertiaDeceleration.max
      )
    }
  }
  if (type === 'power') {
    const record = strictRecord(value, path, ['type', 'mode', 'power'])
    return {
      type: 'power',
      mode: easeMode(required(record, 'mode', path), `${path}.mode`),
      power: integer(required(record, 'power', path), `${path}.power`, 1, 4) as 1 | 2 | 3 | 4
    }
  }
  if (type === 'sine' || type === 'expo' || type === 'circ' || type === 'bounce') {
    const record = strictRecord(value, path, ['type', 'mode'])
    return {
      type,
      mode: easeMode(required(record, 'mode', path), `${path}.mode`)
    }
  }
  if (type === 'back') {
    const record = strictRecord(value, path, ['type', 'mode', 'overshoot'])
    return {
      type: 'back',
      mode: easeMode(required(record, 'mode', path), `${path}.mode`),
      overshoot: boundedNumber(
        required(record, 'overshoot', path),
        `${path}.overshoot`,
        MOTION_LIMITS.backOvershoot.min,
        MOTION_LIMITS.backOvershoot.max
      )
    }
  }
  if (type === 'elastic') {
    const record = strictRecord(value, path, ['type', 'mode', 'amplitude', 'period'])
    return {
      type: 'elastic',
      mode: easeMode(required(record, 'mode', path), `${path}.mode`),
      amplitude: boundedNumber(
        required(record, 'amplitude', path),
        `${path}.amplitude`,
        MOTION_LIMITS.elasticAmplitude.min,
        MOTION_LIMITS.elasticAmplitude.max
      ),
      period: boundedNumber(
        required(record, 'period', path),
        `${path}.period`,
        MOTION_LIMITS.elasticPeriod.min,
        MOTION_LIMITS.elasticPeriod.max
      )
    }
  }
  return invalid(`${path}.type`, 'invalid_value', 'Unknown easing type')
}

function parseColor(value: unknown, path: string): MotionColor {
  const record = strictRecord(value, path, ['r', 'g', 'b', 'a'])
  return {
    r: boundedNumber(required(record, 'r', path), `${path}.r`, 0, 1),
    g: boundedNumber(required(record, 'g', path), `${path}.g`, 0, 1),
    b: boundedNumber(required(record, 'b', path), `${path}.b`, 0, 1),
    a: boundedNumber(required(record, 'a', path), `${path}.a`, 0, 1)
  }
}

function boundedArray(value: unknown, path: string, max: number, label: string): unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'invalid_type', 'Expected an array')
  if (value.length < 1 || value.length > max) {
    return invalid(path, 'limit_exceeded', `Expected between 1 and ${max} ${label}`)
  }
  return value
}

function targetIndex(value: unknown, path: string): number {
  return integer(value, path, MOTION_LIMITS.targetIndex.min, MOTION_LIMITS.targetIndex.max)
}

function parsePathPoint(value: unknown, path: string): MotionPathPoint {
  const record = strictRecord(value, path, ['x', 'y'])
  return {
    x: boundedNumber(
      required(record, 'x', path),
      `${path}.x`,
      MOTION_LIMITS.translate.min,
      MOTION_LIMITS.translate.max
    ),
    y: boundedNumber(
      required(record, 'y', path),
      `${path}.y`,
      MOTION_LIMITS.translate.min,
      MOTION_LIMITS.translate.max
    )
  }
}

function assertUniqueTargets(values: readonly string[], path: string, label: string): void {
  const seen = new Set<string>()
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (seen.has(value)) {
      invalid(`${path}[${index}]`, 'invalid_value', `${label} targets must be unique`)
    }
    seen.add(value)
  }
}

function parsePaintTargets(value: unknown, path: string): MotionPaintTarget[] {
  const targets = boundedArray(value, path, MOTION_LIMITS.maxPaintTargets, 'paint targets').map(
    (candidate, index): MotionPaintTarget => {
      const targetPath = `${path}[${index}]`
      const record = strictRecord(candidate, targetPath, ['kind', 'index', 'color', 'opacity'])
      const kind = required(record, 'kind', targetPath)
      if (!isOneOf(kind, PAINT_KINDS)) {
        return invalid(`${targetPath}.kind`, 'invalid_value', 'Unknown paint kind')
      }
      const target: MotionPaintTarget = {
        kind,
        index: targetIndex(required(record, 'index', targetPath), `${targetPath}.index`)
      }
      if (Object.hasOwn(record, 'color')) {
        target.color = parseColor(record.color, `${targetPath}.color`)
      }
      if (Object.hasOwn(record, 'opacity')) {
        target.opacity = boundedNumber(
          record.opacity,
          `${targetPath}.opacity`,
          MOTION_LIMITS.opacity.min,
          MOTION_LIMITS.opacity.max
        )
      }
      if (target.color === undefined && target.opacity === undefined) {
        return invalid(targetPath, 'invalid_value', 'A paint target requires color or opacity')
      }
      return target
    }
  )
  assertUniqueTargets(
    targets.map((target) => `${target.kind}:${target.index}`),
    path,
    'Paint'
  )
  return targets
}

function parseGradientStopTargets(value: unknown, path: string): MotionGradientStopTarget[] {
  const targets = boundedArray(
    value,
    path,
    MOTION_LIMITS.maxGradientStopTargets,
    'gradient stop targets'
  ).map((candidate, index): MotionGradientStopTarget => {
    const targetPath = `${path}[${index}]`
    const record = strictRecord(candidate, targetPath, [
      'kind',
      'paintIndex',
      'stopIndex',
      'position',
      'color'
    ])
    const kind = required(record, 'kind', targetPath)
    if (!isOneOf(kind, PAINT_KINDS)) {
      return invalid(`${targetPath}.kind`, 'invalid_value', 'Unknown paint kind')
    }
    return {
      kind,
      paintIndex: targetIndex(
        required(record, 'paintIndex', targetPath),
        `${targetPath}.paintIndex`
      ),
      stopIndex: targetIndex(required(record, 'stopIndex', targetPath), `${targetPath}.stopIndex`),
      position: boundedNumber(
        required(record, 'position', targetPath),
        `${targetPath}.position`,
        MOTION_LIMITS.normalized.min,
        MOTION_LIMITS.normalized.max
      ),
      color: parseColor(required(record, 'color', targetPath), `${targetPath}.color`)
    }
  })
  assertUniqueTargets(
    targets.map((target) => `${target.kind}:${target.paintIndex}:${target.stopIndex}`),
    path,
    'Gradient stop'
  )
  return targets
}

function parseEffectTargets(value: unknown, path: string): MotionEffectTarget[] {
  const targets = boundedArray(value, path, MOTION_LIMITS.maxEffectTargets, 'effect targets').map(
    (candidate, index): MotionEffectTarget => {
      const targetPath = `${path}[${index}]`
      const raw = plainRecord(candidate, targetPath)
      const kind = required(raw, 'kind', targetPath)
      if (kind === 'blur') {
        const record = strictRecord(candidate, targetPath, ['kind', 'index', 'radius'])
        return {
          kind,
          index: targetIndex(required(record, 'index', targetPath), `${targetPath}.index`),
          radius: boundedNumber(
            required(record, 'radius', targetPath),
            `${targetPath}.radius`,
            MOTION_LIMITS.blur.min,
            MOTION_LIMITS.blur.max
          )
        }
      }
      if (kind === 'shadow') {
        const record = strictRecord(candidate, targetPath, [
          'kind',
          'index',
          'x',
          'y',
          'blur',
          'spread',
          'color'
        ])
        return {
          kind,
          index: targetIndex(required(record, 'index', targetPath), `${targetPath}.index`),
          x: boundedNumber(
            required(record, 'x', targetPath),
            `${targetPath}.x`,
            MOTION_LIMITS.shadowOffset.min,
            MOTION_LIMITS.shadowOffset.max
          ),
          y: boundedNumber(
            required(record, 'y', targetPath),
            `${targetPath}.y`,
            MOTION_LIMITS.shadowOffset.min,
            MOTION_LIMITS.shadowOffset.max
          ),
          blur: boundedNumber(
            required(record, 'blur', targetPath),
            `${targetPath}.blur`,
            MOTION_LIMITS.blur.min,
            MOTION_LIMITS.blur.max
          ),
          spread: boundedNumber(
            required(record, 'spread', targetPath),
            `${targetPath}.spread`,
            MOTION_LIMITS.shadowSpread.min,
            MOTION_LIMITS.shadowSpread.max
          ),
          color: parseColor(required(record, 'color', targetPath), `${targetPath}.color`)
        }
      }
      return invalid(`${targetPath}.kind`, 'invalid_value', 'Unknown effect kind')
    }
  )
  assertUniqueTargets(
    targets.map((target) => String(target.index)),
    path,
    'Effect'
  )
  return targets
}

function parseCornerRadii(value: unknown, path: string): MotionCornerRadii {
  const record = strictRecord(value, path, ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'])
  const result = {} as MotionCornerRadii
  for (const corner of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const) {
    result[corner] = boundedNumber(
      required(record, corner, path),
      `${path}.${corner}`,
      MOTION_LIMITS.cornerRadius.min,
      MOTION_LIMITS.cornerRadius.max
    )
  }
  return result
}

function parseFontAxes(value: unknown, path: string): MotionFontAxisTarget[] {
  const axes = boundedArray(value, path, MOTION_LIMITS.maxFontAxes, 'font axes').map(
    (candidate, index): MotionFontAxisTarget => {
      const axisPath = `${path}[${index}]`
      const record = strictRecord(candidate, axisPath, ['tag', 'value'])
      const tag = required(record, 'tag', axisPath)
      if (typeof tag !== 'string' || !FONT_AXIS_TAG.test(tag)) {
        return invalid(`${axisPath}.tag`, 'invalid_value', 'Expected a four-character ASCII tag')
      }
      return {
        tag,
        value: boundedNumber(
          required(record, 'value', axisPath),
          `${axisPath}.value`,
          MOTION_LIMITS.fontAxisValue.min,
          MOTION_LIMITS.fontAxisValue.max
        )
      }
    }
  )
  assertUniqueTargets(
    axes.map((axis) => axis.tag),
    path,
    'Font axis'
  )
  return axes
}

function parseVectorMorph(value: unknown, path: string): MotionVectorMorph {
  const record = strictRecord(value, path, ['topologyId', 'points'])
  const topologyId = required(record, 'topologyId', path)
  if (typeof topologyId !== 'string' || !SAFE_TOPOLOGY_ID.test(topologyId)) {
    return invalid(
      `${path}.topologyId`,
      'invalid_value',
      `Expected a safe topology id of at most ${MOTION_LIMITS.maxTopologyIdLength} characters`
    )
  }
  return {
    topologyId,
    points: boundedArray(
      required(record, 'points', path),
      `${path}.points`,
      MOTION_LIMITS.maxVectorMorphPoints,
      'vector morph points'
    ).map((point, index) => parsePathPoint(point, `${path}.points[${index}]`))
  }
}

const V1_KEYFRAME_KEYS = [
  'offset',
  'opacity',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotate',
  'easing'
] as const

const V2_KEYFRAME_KEYS = [
  ...V1_KEYFRAME_KEYS,
  'originX',
  'originY',
  'width',
  'height',
  'cornerRadius',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'blur',
  'shadowX',
  'shadowY',
  'shadowBlur',
  'shadowSpread',
  'shadowColor',
  'pathProgress',
  'trimStart',
  'trimEnd',
  'trimOffset',
  'gap',
  'rowGap',
  'columnGap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft'
] as const

const V3_ADVANCED_KEYFRAME_KEYS = [
  'paints',
  'gradientStops',
  'effects',
  'cornerRadii',
  'textReveal',
  'fontAxes',
  'vectorMorph'
] as const

const V3_KEYFRAME_KEYS = ['id', ...V2_KEYFRAME_KEYS, ...V3_ADVANCED_KEYFRAME_KEYS] as const

const BASE_BOUNDED_KEYFRAME_FIELDS = {
  opacity: MOTION_LIMITS.opacity,
  x: MOTION_LIMITS.translate,
  y: MOTION_LIMITS.translate,
  scaleX: MOTION_LIMITS.scale,
  scaleY: MOTION_LIMITS.scale,
  rotate: MOTION_LIMITS.rotate
} as const

const V2_BOUNDED_KEYFRAME_FIELDS = {
  originX: MOTION_LIMITS.normalized,
  originY: MOTION_LIMITS.normalized,
  width: MOTION_LIMITS.dimension,
  height: MOTION_LIMITS.dimension,
  cornerRadius: MOTION_LIMITS.cornerRadius,
  strokeWidth: MOTION_LIMITS.strokeWidth,
  blur: MOTION_LIMITS.blur,
  shadowX: MOTION_LIMITS.shadowOffset,
  shadowY: MOTION_LIMITS.shadowOffset,
  shadowBlur: MOTION_LIMITS.blur,
  shadowSpread: MOTION_LIMITS.shadowSpread,
  pathProgress: MOTION_LIMITS.normalized,
  trimStart: MOTION_LIMITS.normalized,
  trimEnd: MOTION_LIMITS.normalized,
  trimOffset: MOTION_LIMITS.trimOffset,
  gap: MOTION_LIMITS.layout,
  rowGap: MOTION_LIMITS.layout,
  columnGap: MOTION_LIMITS.layout,
  paddingTop: MOTION_LIMITS.layout,
  paddingRight: MOTION_LIMITS.layout,
  paddingBottom: MOTION_LIMITS.layout,
  paddingLeft: MOTION_LIMITS.layout
} as const

type BoundedKeyframeField =
  | keyof typeof BASE_BOUNDED_KEYFRAME_FIELDS
  | keyof typeof V2_BOUNDED_KEYFRAME_FIELDS

const V2_CHANNEL_KEYS = V2_KEYFRAME_KEYS.filter(
  (key) => !V1_KEYFRAME_KEYS.includes(key as (typeof V1_KEYFRAME_KEYS)[number])
) as ReadonlyArray<Exclude<(typeof V2_KEYFRAME_KEYS)[number], (typeof V1_KEYFRAME_KEYS)[number]>>

function parseBoundedKeyframeFields(
  record: Record<string, unknown>,
  keyframe: MotionKeyframe,
  path: string,
  fields: Readonly<Partial<Record<BoundedKeyframeField, Readonly<{ min: number; max: number }>>>>
): void {
  const target: Partial<Record<BoundedKeyframeField, number>> = keyframe
  for (const field of Object.keys(fields) as BoundedKeyframeField[]) {
    if (!Object.hasOwn(record, field)) continue
    const limit = fields[field]
    if (!limit) continue
    target[field] = boundedNumber(record[field], `${path}.${field}`, limit.min, limit.max)
  }
}

function parseV2KeyframeFields(
  record: Record<string, unknown>,
  keyframe: MotionKeyframe,
  path: string
): void {
  parseBoundedKeyframeFields(record, keyframe, path, V2_BOUNDED_KEYFRAME_FIELDS)
  for (const field of ['fillColor', 'strokeColor', 'shadowColor'] as const) {
    if (Object.hasOwn(record, field))
      keyframe[field] = parseColor(record[field], `${path}.${field}`)
  }
  if (
    keyframe.trimStart !== undefined &&
    keyframe.trimEnd !== undefined &&
    keyframe.trimStart > keyframe.trimEnd
  ) {
    invalid(path, 'invalid_value', 'trimStart must not exceed trimEnd')
  }
}

function parseV3KeyframeFields(
  record: Record<string, unknown>,
  keyframe: MotionKeyframe,
  path: string
): void {
  if (Object.hasOwn(record, 'paints')) {
    keyframe.paints = parsePaintTargets(record.paints, `${path}.paints`)
  }
  if (Object.hasOwn(record, 'gradientStops')) {
    keyframe.gradientStops = parseGradientStopTargets(record.gradientStops, `${path}.gradientStops`)
  }
  if (Object.hasOwn(record, 'effects')) {
    keyframe.effects = parseEffectTargets(record.effects, `${path}.effects`)
  }
  if (Object.hasOwn(record, 'cornerRadii')) {
    keyframe.cornerRadii = parseCornerRadii(record.cornerRadii, `${path}.cornerRadii`)
  }
  if (Object.hasOwn(record, 'textReveal')) {
    keyframe.textReveal = boundedNumber(
      record.textReveal,
      `${path}.textReveal`,
      MOTION_LIMITS.normalized.min,
      MOTION_LIMITS.normalized.max
    )
  }
  if (Object.hasOwn(record, 'fontAxes')) {
    keyframe.fontAxes = parseFontAxes(record.fontAxes, `${path}.fontAxes`)
  }
  if (Object.hasOwn(record, 'vectorMorph')) {
    keyframe.vectorMorph = parseVectorMorph(record.vectorMorph, `${path}.vectorMorph`)
  }
}

function parseKeyframe(
  value: unknown,
  path: string,
  version: MotionSpec['version']
): MotionKeyframe {
  let allowedKeys: readonly string[] = V1_KEYFRAME_KEYS
  if (version === 2) allowedKeys = V2_KEYFRAME_KEYS
  if (version === 3) allowedKeys = V3_KEYFRAME_KEYS
  const record = strictRecord(value, path, allowedKeys)
  const keyframe: MotionKeyframe = {
    offset: boundedNumber(required(record, 'offset', path), `${path}.offset`, 0, 1)
  }
  if (version === 3 && Object.hasOwn(record, 'id')) {
    keyframe.id = safeId(record.id, `${path}.id`)
  }
  parseBoundedKeyframeFields(record, keyframe, path, BASE_BOUNDED_KEYFRAME_FIELDS)
  if (version !== 1) parseV2KeyframeFields(record, keyframe, path)
  if (Object.hasOwn(record, 'easing')) {
    keyframe.easing = parseMotionEasing(record.easing, `${path}.easing`, version)
  }
  if (version === 3) parseV3KeyframeFields(record, keyframe, path)
  return keyframe
}

function parseTiming(value: unknown, path: string, version: MotionSpec['version']): MotionTiming {
  const record = strictRecord(value, path, [
    'durationMs',
    'delayMs',
    'easing',
    'iterations',
    'direction',
    'fill'
  ])
  const timing: MotionTiming = {
    durationMs: boundedNumber(
      required(record, 'durationMs', path),
      `${path}.durationMs`,
      MOTION_LIMITS.durationMs.min,
      MOTION_LIMITS.durationMs.max
    )
  }
  if (Object.hasOwn(record, 'delayMs')) {
    timing.delayMs = boundedNumber(
      record.delayMs,
      `${path}.delayMs`,
      MOTION_LIMITS.delayMs.min,
      MOTION_LIMITS.delayMs.max
    )
  }
  if (Object.hasOwn(record, 'easing')) {
    timing.easing = parseMotionEasing(record.easing, `${path}.easing`, version)
  }
  if (Object.hasOwn(record, 'iterations')) {
    timing.iterations =
      record.iterations === 'infinite'
        ? 'infinite'
        : boundedNumber(
            record.iterations,
            `${path}.iterations`,
            MOTION_LIMITS.iterations.min,
            MOTION_LIMITS.iterations.max
          )
  }
  if (Object.hasOwn(record, 'direction')) {
    if (!isOneOf(record.direction, DIRECTIONS)) {
      return invalid(`${path}.direction`, 'invalid_value', 'Unknown direction')
    }
    timing.direction = record.direction
  }
  if (Object.hasOwn(record, 'fill')) {
    if (!isOneOf(record.fill, FILLS))
      return invalid(`${path}.fill`, 'invalid_value', 'Unknown fill')
    timing.fill = record.fill
  }
  return timing
}

function parseAutoRotate(record: Record<string, unknown>, path: string): boolean | undefined {
  if (!Object.hasOwn(record, 'autoRotate')) return undefined
  if (typeof record.autoRotate !== 'boolean') {
    return invalid(`${path}.autoRotate`, 'invalid_type', 'Expected a boolean')
  }
  return record.autoRotate
}

function parsePolylinePath(value: unknown, path: string, explicitVersion: boolean): MotionPath {
  const record = strictRecord(
    value,
    path,
    explicitVersion ? ['version', 'points', 'autoRotate'] : ['points', 'autoRotate']
  )
  if (explicitVersion && record.version !== 1) {
    return invalid(`${path}.version`, 'invalid_value', 'Expected polyline path version 1')
  }
  const points = boundedArray(
    required(record, 'points', path),
    `${path}.points`,
    MOTION_LIMITS.maxPathPoints,
    'path points'
  )
  if (points.length < 2) {
    return invalid(`${path}.points`, 'limit_exceeded', 'Expected at least 2 path points')
  }
  const autoRotate = parseAutoRotate(record, path)
  return {
    ...(explicitVersion ? { version: 1 as const } : {}),
    points: points.map((point, index) => parsePathPoint(point, `${path}.points[${index}]`)),
    ...(autoRotate === undefined ? {} : { autoRotate })
  }
}

function parseCubicPath(value: unknown, path: string): MotionPath {
  const record = strictRecord(value, path, ['version', 'start', 'segments', 'autoRotate'])
  if (record.version !== 2) {
    return invalid(`${path}.version`, 'invalid_value', 'Expected cubic path version 2')
  }
  const segments = boundedArray(
    required(record, 'segments', path),
    `${path}.segments`,
    MOTION_LIMITS.maxPathSegments,
    'cubic path segments'
  ).map((candidate, index) => {
    const segmentPath = `${path}.segments[${index}]`
    const segment = strictRecord(candidate, segmentPath, ['control1', 'control2', 'end'])
    return {
      control1: parsePathPoint(
        required(segment, 'control1', segmentPath),
        `${segmentPath}.control1`
      ),
      control2: parsePathPoint(
        required(segment, 'control2', segmentPath),
        `${segmentPath}.control2`
      ),
      end: parsePathPoint(required(segment, 'end', segmentPath), `${segmentPath}.end`)
    }
  })
  const autoRotate = parseAutoRotate(record, path)
  return {
    version: 2,
    start: parsePathPoint(required(record, 'start', path), `${path}.start`),
    segments,
    ...(autoRotate === undefined ? {} : { autoRotate })
  }
}

function parsePath(value: unknown, path: string, specVersion: MotionSpec['version']): MotionPath {
  if (specVersion !== 3) return parsePolylinePath(value, path, false)
  const record = plainRecord(value, path)
  if (!Object.hasOwn(record, 'version')) return parsePolylinePath(value, path, false)
  if (record.version === 1) return parsePolylinePath(value, path, true)
  if (record.version === 2) return parseCubicPath(value, path)
  return invalid(`${path}.version`, 'invalid_value', 'Unknown Motion path version')
}

function parseTrackKeyframes(
  record: Record<string, unknown>,
  path: string,
  version: MotionSpec['version']
): MotionKeyframe[] {
  const rawKeyframes = required(record, 'keyframes', path)
  if (!Array.isArray(rawKeyframes)) {
    return invalid(`${path}.keyframes`, 'invalid_type', 'Expected an array')
  }
  if (rawKeyframes.length < 2 || rawKeyframes.length > MOTION_LIMITS.maxKeyframes) {
    return invalid(
      `${path}.keyframes`,
      'limit_exceeded',
      `Expected between 2 and ${MOTION_LIMITS.maxKeyframes} keyframes`
    )
  }
  const keyframes = rawKeyframes.map((keyframe, index) =>
    parseKeyframe(keyframe, `${path}.keyframes[${index}]`, version)
  )
  validateTrackKeyframes(keyframes, path, version)
  return keyframes
}

function validateTrackKeyframes(
  keyframes: MotionKeyframe[],
  path: string,
  version: MotionSpec['version']
): void {
  if (keyframes[0].offset !== 0 || keyframes.at(-1)?.offset !== 1) {
    invalid(`${path}.keyframes`, 'invalid_value', 'First offset must be 0 and last offset 1')
  }
  for (let index = 1; index < keyframes.length; index++) {
    if (keyframes[index].offset < keyframes[index - 1].offset) {
      invalid(
        `${path}.keyframes[${index}].offset`,
        'invalid_value',
        'Offsets must be non-decreasing'
      )
    }
  }
  if (version !== 1) {
    const channelKeys =
      version === 3 ? [...V2_CHANNEL_KEYS, ...V3_ADVANCED_KEYFRAME_KEYS] : V2_CHANNEL_KEYS
    for (const field of channelKeys) {
      const authored = keyframes.filter((keyframe) => keyframe[field] !== undefined).length
      if (authored > 0 && authored !== keyframes.length) {
        invalid(
          `${path}.keyframes`,
          'invalid_value',
          `MotionSpec v2+ channel ${field} must be present on every keyframe when used`
        )
      }
    }
  }
  if (version === 3) validateAdvancedChannelTopology(keyframes, path)
  if (version === 3) {
    const ids = new Set<string>()
    for (let index = 0; index < keyframes.length; index++) {
      const id = keyframes[index].id
      if (!id) continue
      if (ids.has(id)) {
        invalid(
          `${path}.keyframes[${index}].id`,
          'invalid_value',
          'Keyframe ids must be unique within a track'
        )
      }
      ids.add(id)
    }
  }
}

function validateMatchingSignatures(
  keyframes: readonly MotionKeyframe[],
  path: string,
  field: (typeof V3_ADVANCED_KEYFRAME_KEYS)[number],
  signature: (keyframe: MotionKeyframe) => string | undefined
): void {
  const expected = signature(keyframes[0])
  if (expected === undefined) return
  for (let index = 1; index < keyframes.length; index++) {
    if (signature(keyframes[index]) !== expected) {
      invalid(
        `${path}.keyframes[${index}].${field}`,
        'invalid_value',
        `${field} target topology must match every keyframe`
      )
    }
  }
}

function validateAdvancedChannelTopology(keyframes: readonly MotionKeyframe[], path: string): void {
  validateMatchingSignatures(keyframes, path, 'paints', (keyframe) =>
    keyframe.paints
      ?.map(
        (target) =>
          `${target.kind}:${target.index}:${target.color === undefined ? 0 : 1}:${target.opacity === undefined ? 0 : 1}`
      )
      .join('|')
  )
  validateMatchingSignatures(keyframes, path, 'gradientStops', (keyframe) =>
    keyframe.gradientStops
      ?.map((target) => `${target.kind}:${target.paintIndex}:${target.stopIndex}`)
      .join('|')
  )
  validateMatchingSignatures(keyframes, path, 'effects', (keyframe) =>
    keyframe.effects?.map((target) => `${target.kind}:${target.index}`).join('|')
  )
  validateMatchingSignatures(keyframes, path, 'fontAxes', (keyframe) =>
    keyframe.fontAxes?.map((axis) => axis.tag).join('|')
  )
  validateMatchingSignatures(keyframes, path, 'vectorMorph', (keyframe) => {
    const morph = keyframe.vectorMorph
    return morph ? `${morph.topologyId}:${morph.points.length}` : undefined
  })
}

function parseTrackOptions(
  track: MotionTrack,
  record: Record<string, unknown>,
  path: string,
  version: MotionSpec['version']
): void {
  if (Object.hasOwn(record, 'exit')) {
    if (isOneOf(record.exit, EXITS)) track.exit = record.exit
    else invalid(`${path}.exit`, 'invalid_value', 'Unknown exit')
  }
  if (version !== 1 && Object.hasOwn(record, 'path')) {
    track.path = parsePath(record.path, `${path}.path`, version)
  }
  const usesPath = track.keyframes.some((keyframe) => keyframe.pathProgress !== undefined)
  if (usesPath !== (track.path !== undefined)) {
    invalid(
      path,
      'invalid_value',
      usesPath
        ? 'pathProgress requires a track path'
        : 'A track path requires pathProgress keyframes'
    )
  }
  if (version === 3 && Object.hasOwn(record, 'name')) {
    track.name = trackName(record.name, `${path}.name`)
  }
  if (version === 3 && Object.hasOwn(record, 'composition')) {
    track.composition = parseTrackComposition(record.composition, `${path}.composition`)
    validateTrackCompositionChannels(track, path)
  }
}

function parseTrackComposition(value: unknown, path: string): MotionTrackComposition {
  const record = strictRecord(value, path, ['mode', 'weight', 'priority'])
  const mode = required(record, 'mode', path)
  if (!isOneOf(mode, COMPOSITE_MODES)) {
    return invalid(`${path}.mode`, 'invalid_value', 'Unknown track composition mode')
  }
  const composition: MotionTrackComposition = { mode }
  if (Object.hasOwn(record, 'weight')) {
    composition.weight = boundedNumber(record.weight, `${path}.weight`, 0, 1)
  }
  if (Object.hasOwn(record, 'priority')) {
    composition.priority = integer(record.priority, `${path}.priority`, -1_000, 1_000)
  }
  return composition
}

function validateTrackCompositionChannels(track: MotionTrack, path: string): void {
  const composition = track.composition
  if (!composition) return
  const channels = getMotionChannels(track.keyframes)
  const unsupported = Object.entries(channels)
    .filter(([channel, active]) => active && !COMPOSABLE_CHANNELS.has(channel))
    .map(([channel]) => channel)
  if (unsupported.length === 0) return
  if (composition.mode !== 'replace') {
    invalid(
      `${path}.composition.mode`,
      'invalid_value',
      `Non-replace composition only supports transform and opacity channels; unsupported: ${unsupported.join(', ')}`
    )
  }
  if ((composition.weight ?? 1) !== 1) {
    invalid(
      `${path}.composition.weight`,
      'invalid_value',
      `Weighted composition only supports transform and opacity channels; unsupported: ${unsupported.join(', ')}`
    )
  }
}

function parseTrack(value: unknown, path: string, version: MotionSpec['version']): MotionTrack {
  let allowedKeys = ['id', 'trigger', 'keyframes', 'timing', 'exit']
  if (version >= 2) allowedKeys = [...allowedKeys, 'path']
  if (version === 3) allowedKeys = [...allowedKeys, 'name', 'composition']
  const record = strictRecord(value, path, allowedKeys)
  const keyframes = parseTrackKeyframes(record, path, version)
  const trigger = required(record, 'trigger', path)
  if (!isOneOf(trigger, TRIGGERS)) {
    return invalid(`${path}.trigger`, 'invalid_value', 'Unknown trigger')
  }
  const track: MotionTrack = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    trigger,
    keyframes,
    timing: parseTiming(required(record, 'timing', path), `${path}.timing`, version)
  }
  parseTrackOptions(track, record, path, version)
  return track
}

function parsePresetParameters(value: unknown, path: string): MotionPresetProvenance['parameters'] {
  const record = plainRecord(value, path)
  const keys = Object.keys(record)
  if (keys.length > MOTION_LIMITS.maxPresetParameters) {
    return invalid(path, 'limit_exceeded', 'Too many preset parameters')
  }
  const parameters: MotionPresetProvenance['parameters'] = {}
  for (const key of keys) {
    safeId(key, `${path}.${key}`)
    const parameter = record[key]
    if (typeof parameter === 'number') parameters[key] = finiteNumber(parameter, `${path}.${key}`)
    else if (typeof parameter === 'boolean') parameters[key] = parameter
    else if (typeof parameter === 'string' && SAFE_PARAMETER_STRING.test(parameter)) {
      parameters[key] = parameter
    } else {
      invalid(
        `${path}.${key}`,
        'invalid_value',
        `Expected a safe scalar of at most ${MOTION_LIMITS.maxParameterStringLength} characters`
      )
    }
  }
  return parameters
}

export function parseMotionPresetProvenance(
  value: unknown,
  path = 'preset'
): MotionPresetProvenance {
  const record = strictRecord(value, path, ['id', 'version', 'parameters'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    version: integer(required(record, 'version', path), `${path}.version`, 1, 1_000),
    parameters: parsePresetParameters(required(record, 'parameters', path), `${path}.parameters`)
  }
}

export function parseMotionSpec(value: unknown): MotionSpec {
  const record = strictRecord(value, 'motion', ['version', 'tracks', 'reducedMotion', 'preset'])
  const rawVersion = required(record, 'version', 'motion')
  if (rawVersion !== 1 && rawVersion !== 2 && rawVersion !== 3) {
    return invalid(
      'motion.version',
      'invalid_value',
      'Only MotionSpec versions 1, 2, and 3 are supported'
    )
  }
  const version: MotionSpec['version'] = rawVersion
  const rawTracks = required(record, 'tracks', 'motion')
  if (!Array.isArray(rawTracks))
    return invalid('motion.tracks', 'invalid_type', 'Expected an array')
  if (rawTracks.length < 1 || rawTracks.length > MOTION_LIMITS.maxTracks) {
    return invalid(
      'motion.tracks',
      'limit_exceeded',
      `Expected between 1 and ${MOTION_LIMITS.maxTracks} tracks`
    )
  }
  const tracks = rawTracks.map((track, index) =>
    parseTrack(track, `motion.tracks[${index}]`, version)
  )
  const ids = new Set<string>()
  let keyframeCount = 0
  for (const track of tracks) {
    if (ids.has(track.id))
      return invalid('motion.tracks', 'invalid_value', 'Track ids must be unique')
    ids.add(track.id)
    keyframeCount += track.keyframes.length
  }
  if (keyframeCount > MOTION_LIMITS.maxKeyframes) {
    return invalid(
      'motion.tracks',
      'limit_exceeded',
      `A spec may contain at most ${MOTION_LIMITS.maxKeyframes} keyframes`
    )
  }
  const spec: MotionSpec = { version, tracks }
  if (Object.hasOwn(record, 'reducedMotion')) {
    if (!isOneOf(record.reducedMotion, REDUCED_MOTION)) {
      return invalid('motion.reducedMotion', 'invalid_value', 'Unknown reduced-motion policy')
    }
    spec.reducedMotion = record.reducedMotion
  }
  if (Object.hasOwn(record, 'preset')) {
    spec.preset = parseMotionPresetProvenance(record.preset, 'motion.preset')
  }
  return spec
}

export function validateMotionSpec(value: unknown): MotionValidationResult {
  try {
    return { success: true, value: parseMotionSpec(value) }
  } catch (error) {
    if (error instanceof MotionValidationError) return { success: false, issues: error.issues }
    throw error
  }
}

export function isMotionSpec(value: unknown): value is MotionSpec {
  return validateMotionSpec(value).success
}

function cloneEasing(easing: MotionEasing | undefined): MotionEasing | undefined {
  return typeof easing === 'object' ? { ...easing } : easing
}

/** Return a fresh copy without sharing any mutable nested MotionSpec values. */
export function cloneMotionSpec(spec: MotionSpec): MotionSpec {
  const copy: MotionSpec = {
    version: spec.version,
    tracks: spec.tracks.map((track) => {
      const keyframes = track.keyframes.map(cloneMotionKeyframe)
      const timing = { ...track.timing }
      if (track.timing.easing === undefined) delete timing.easing
      else timing.easing = cloneEasing(track.timing.easing)
      const trackCopy = { ...track, keyframes, timing }
      if (track.composition) trackCopy.composition = { ...track.composition }
      if (track.path) {
        trackCopy.path = cloneMotionPath(track.path)
      }
      return trackCopy
    })
  }
  if (spec.reducedMotion !== undefined) copy.reducedMotion = spec.reducedMotion
  if (spec.preset) {
    copy.preset = { ...spec.preset, parameters: { ...spec.preset.parameters } }
  }
  return copy
}

/** Upgrade validated v1 data to the v2 envelope without changing its behavior. */
export function upgradeMotionSpecV2(value: unknown): MotionSpec {
  const spec = parseMotionSpec(value)
  if (spec.version !== 1) return spec
  return { ...spec, version: 2 }
}

/** Upgrade validated v1/v2 data to the v3 envelope without changing behavior. */
export function upgradeMotionSpecV3(value: unknown): MotionSpec {
  const spec = parseMotionSpec(value)
  if (spec.version === 3) return spec
  return { ...spec, version: 3 }
}
