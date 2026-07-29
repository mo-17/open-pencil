import {
  MOTION_LIMITS,
  type MotionColor,
  type MotionKeyframe,
  type MotionPath,
  type MotionPolylinePath,
  type MotionSpec
} from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { editAuthoredMotionSpec, requireMotionTrack as findTrack } from './spec-edit'

export const MOTION_V2_NUMERIC_CHANNELS = [
  'originX',
  'originY',
  'width',
  'height',
  'cornerRadius',
  'strokeWidth',
  'blur',
  'shadowX',
  'shadowY',
  'shadowBlur',
  'shadowSpread',
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

export const MOTION_V2_COLOR_CHANNELS = ['fillColor', 'strokeColor', 'shadowColor'] as const

export type MotionV2NumericChannel = (typeof MOTION_V2_NUMERIC_CHANNELS)[number]
export type MotionV2ColorChannel = (typeof MOTION_V2_COLOR_CHANNELS)[number]
export type MotionColorComponent = keyof MotionColor

type MotionLimit = Readonly<{ min: number; max: number }>

function editMotionV2(spec: MotionSpec, edit: (draft: MotionSpec) => void): MotionSpec {
  if (spec.version === 1) {
    throw new RangeError('Advanced motion channels require MotionSpec version 2 or newer')
  }
  return editAuthoredMotionSpec(spec, edit)
}

function clamp(value: number, limits: MotionLimit): number {
  if (!Number.isFinite(value)) return limits.min
  return Math.min(limits.max, Math.max(limits.min, value))
}

function boundedColor(color: MotionColor): MotionColor {
  return {
    r: clamp(color.r, MOTION_LIMITS.normalized),
    g: clamp(color.g, MOTION_LIMITS.normalized),
    b: clamp(color.b, MOTION_LIMITS.normalized),
    a: clamp(color.a, MOTION_LIMITS.normalized)
  }
}

function requirePolylinePath(
  path: MotionPath | undefined,
  missingMessage: string
): MotionPolylinePath {
  if (!path) throw new RangeError(missingMessage)
  if (path.version === 2) {
    throw new RangeError('Cubic motion paths require the cubic path editor')
  }
  return path
}

function withoutMotionChannel(
  keyframe: MotionKeyframe,
  channel: MotionV2NumericChannel | MotionV2ColorChannel
): MotionKeyframe {
  const { [channel]: omitted, ...remaining } = keyframe
  void omitted
  return remaining
}

export function motionV2NumericLimit(channel: MotionV2NumericChannel): MotionLimit {
  if (channel === 'originX' || channel === 'originY') return MOTION_LIMITS.normalized
  if (channel === 'width' || channel === 'height') return MOTION_LIMITS.dimension
  if (channel === 'cornerRadius') return MOTION_LIMITS.cornerRadius
  if (channel === 'strokeWidth') return MOTION_LIMITS.strokeWidth
  if (channel === 'blur' || channel === 'shadowBlur') return MOTION_LIMITS.blur
  if (channel === 'shadowX' || channel === 'shadowY') return MOTION_LIMITS.shadowOffset
  if (channel === 'shadowSpread') return MOTION_LIMITS.shadowSpread
  if (channel === 'trimStart' || channel === 'trimEnd') return MOTION_LIMITS.normalized
  if (channel === 'trimOffset') return MOTION_LIMITS.trimOffset
  return MOTION_LIMITS.layout
}

export function upgradeMotionSpecToV2(spec: MotionSpec): MotionSpec {
  if (spec.version !== 1) return spec
  return editAuthoredMotionSpec(spec, (draft) => {
    draft.version = 2
  })
}

export function setMotionV2NumericChannelEnabled(
  spec: MotionSpec,
  trackId: string,
  channel: MotionV2NumericChannel,
  enabled: boolean,
  initialValue: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const track = findTrack(draft, trackId)
    const value = clamp(initialValue, motionV2NumericLimit(channel))
    if (!enabled) {
      track.keyframes = track.keyframes.map((keyframe) => withoutMotionChannel(keyframe, channel))
      return
    }
    for (const keyframe of track.keyframes) {
      if (channel === 'trimStart' && keyframe.trimEnd !== undefined) {
        keyframe[channel] = Math.min(value, keyframe.trimEnd)
      } else if (channel === 'trimEnd' && keyframe.trimStart !== undefined) {
        keyframe[channel] = Math.max(value, keyframe.trimStart)
      } else {
        keyframe[channel] = value
      }
    }
  })
}

export function setMotionV2NumericChannel(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  channel: MotionV2NumericChannel,
  value: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const keyframe = findTrack(draft, trackId).keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    if (keyframe[channel] === undefined) {
      throw new RangeError(`Motion channel ${channel} must be enabled before editing`)
    }
    const limits = motionV2NumericLimit(channel)
    let bounded = clamp(value, limits)
    if (channel === 'trimStart' && keyframe.trimEnd !== undefined) {
      bounded = Math.min(bounded, keyframe.trimEnd)
    } else if (channel === 'trimEnd' && keyframe.trimStart !== undefined) {
      bounded = Math.max(bounded, keyframe.trimStart)
    }
    keyframe[channel] = bounded
  })
}

export function setMotionV2ColorChannelEnabled(
  spec: MotionSpec,
  trackId: string,
  channel: MotionV2ColorChannel,
  enabled: boolean,
  initialValue: MotionColor
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const track = findTrack(draft, trackId)
    const value = boundedColor(initialValue)
    if (!enabled) {
      track.keyframes = track.keyframes.map((keyframe) => withoutMotionChannel(keyframe, channel))
      return
    }
    for (const keyframe of track.keyframes) {
      keyframe[channel] = { ...value }
    }
  })
}

export function setMotionV2ColorComponent(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  channel: MotionV2ColorChannel,
  component: MotionColorComponent,
  value: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const keyframe = findTrack(draft, trackId).keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    const color = keyframe[channel]
    if (!color) throw new RangeError(`Motion channel ${channel} must be enabled before editing`)
    keyframe[channel] = { ...color, [component]: clamp(value, MOTION_LIMITS.normalized) }
  })
}

export function setMotionPathEnabled(
  spec: MotionSpec,
  trackId: string,
  enabled: boolean,
  endpoint: Readonly<Vector> = { x: 100, y: 0 }
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const track = findTrack(draft, trackId)
    if (!enabled) {
      delete track.path
      for (const keyframe of track.keyframes) delete keyframe.pathProgress
      return
    }
    track.path ??= {
      points: [
        { x: 0, y: 0 },
        {
          x: clamp(endpoint.x, MOTION_LIMITS.translate),
          y: clamp(endpoint.y, MOTION_LIMITS.translate)
        }
      ],
      autoRotate: false
    }
    for (const keyframe of track.keyframes) keyframe.pathProgress = keyframe.offset
  })
}

export function setMotionPathProgress(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number,
  value: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const track = findTrack(draft, trackId)
    if (!track.path) throw new RangeError('Enable a motion path before editing its progress')
    const keyframe = track.keyframes.at(keyframeIndex)
    if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
    for (const frame of track.keyframes) frame.pathProgress ??= frame.offset
    keyframe.pathProgress = clamp(value, MOTION_LIMITS.normalized)
  })
}

export function setMotionPathAutoRotate(
  spec: MotionSpec,
  trackId: string,
  autoRotate: boolean
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const path = findTrack(draft, trackId).path
    if (!path) throw new RangeError('Enable a motion path before editing auto rotate')
    path.autoRotate = autoRotate
  })
}

export function setMotionPathPoint(
  spec: MotionSpec,
  trackId: string,
  pointIndex: number,
  axis: 'x' | 'y',
  value: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const path = requirePolylinePath(
      findTrack(draft, trackId).path,
      'Enable a motion path before editing points'
    )
    const point = path.points.at(pointIndex)
    if (!point) throw new Error(`Unknown motion path point index: ${pointIndex}`)
    point[axis] = clamp(value, MOTION_LIMITS.translate)
  })
}

export function addMotionPathPoint(spec: MotionSpec, trackId: string): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const path = requirePolylinePath(
      findTrack(draft, trackId).path,
      'Enable a motion path before adding points'
    )
    if (path.points.length >= MOTION_LIMITS.maxPathPoints) {
      throw new RangeError(`Motion paths support at most ${MOTION_LIMITS.maxPathPoints} points`)
    }
    const last = path.points.at(-1) ?? { x: 0, y: 0 }
    const previous = path.points.at(-2) ?? { x: last.x - 100, y: last.y }
    path.points.push({
      x: clamp(last.x + (last.x - previous.x), MOTION_LIMITS.translate),
      y: clamp(last.y + (last.y - previous.y), MOTION_LIMITS.translate)
    })
  })
}

export function removeMotionPathPoint(
  spec: MotionSpec,
  trackId: string,
  pointIndex: number
): MotionSpec {
  return editMotionV2(spec, (draft) => {
    const path = requirePolylinePath(
      findTrack(draft, trackId).path,
      'Enable a motion path before removing points'
    )
    if (path.points.length <= 2) throw new RangeError('Motion paths require at least two points')
    if (!path.points.at(pointIndex)) {
      throw new Error(`Unknown motion path point index: ${pointIndex}`)
    }
    path.points.splice(pointIndex, 1)
  })
}

export function motionV2ChannelEnabled(
  keyframe: MotionKeyframe,
  channel: MotionV2NumericChannel | MotionV2ColorChannel
): boolean {
  return keyframe[channel] !== undefined
}
