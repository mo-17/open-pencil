import {
  inspectMotionAdvancedChannels,
  motionAdvancedChannelTemplate,
  type MotionAdvancedCapabilityIssue
} from '@open-pencil/core/motion'
import {
  type MotionColor,
  type MotionKeyframe,
  type MotionSpec,
  type SceneNode
} from '@open-pencil/scene-graph'

import { editAuthoredMotionSpec, requireMotionTrack } from './spec-edit'

export const MOTION_STRUCTURED_CHANNELS = [
  'paints',
  'gradientStops',
  'effects',
  'cornerRadii',
  'textReveal',
  'fontAxes',
  'vectorMorph'
] as const

export type MotionStructuredChannel = (typeof MOTION_STRUCTURED_CHANNELS)[number]
export type MotionStructuredArrayChannel = 'paints' | 'gradientStops' | 'effects' | 'fontAxes'

export interface MotionStructuredCapability {
  supported: boolean
  reason?: string
}

export const MOTION_STRUCTURED_CHANNEL_LABEL_KEYS: Record<MotionStructuredChannel, string> = {
  paints: 'motionStructuredPaints',
  gradientStops: 'motionStructuredGradientStops',
  effects: 'motionStructuredEffects',
  cornerRadii: 'motionStructuredCornerRadii',
  textReveal: 'motionStructuredTextReveal',
  fontAxes: 'motionStructuredFontAxes',
  vectorMorph: 'motionStructuredVectorMorph'
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function boundedMotionStructuredColor(color: MotionColor): MotionColor {
  return {
    r: bounded(color.r, 0, 1),
    g: bounded(color.g, 0, 1),
    b: bounded(color.b, 0, 1),
    a: bounded(color.a, 0, 1)
  }
}

export function upgradeMotionSpecToV3(spec: MotionSpec): MotionSpec {
  if (spec.version === 3) return spec
  return editAuthoredMotionSpec(spec, (draft) => {
    draft.version = 3
  })
}

export function motionStructuredChannelEnabled(
  keyframe: MotionKeyframe,
  channel: MotionStructuredChannel
): boolean {
  return keyframe[channel] !== undefined
}

export function motionStructuredCapability(
  node: SceneNode,
  channel: MotionStructuredChannel
): MotionStructuredCapability {
  const template = motionAdvancedChannelTemplate(node, channel)
  return {
    supported: template.supported,
    ...(template.reason ? { reason: template.reason } : {})
  }
}

export function motionStructuredIssues(
  node: SceneNode,
  spec: MotionSpec
): MotionAdvancedCapabilityIssue[] {
  return spec.tracks.flatMap((track) =>
    track.keyframes.flatMap((keyframe) => inspectMotionAdvancedChannels(node, keyframe))
  )
}

function requireTargetObject(channel: MotionStructuredArrayChannel, target: unknown): object {
  if (typeof target !== 'object' || target === null) {
    throw new RangeError(`Invalid ${channel} target template`)
  }
  return target
}

function paintTargetSignature(target: object): string {
  if (
    !('kind' in target) ||
    (target.kind !== 'fill' && target.kind !== 'stroke') ||
    !('index' in target) ||
    typeof target.index !== 'number'
  ) {
    throw new RangeError('Invalid paints target template')
  }
  return `${target.kind}:${target.index}`
}

function gradientStopTargetSignature(target: object): string {
  if (
    !('kind' in target) ||
    (target.kind !== 'fill' && target.kind !== 'stroke') ||
    !('paintIndex' in target) ||
    typeof target.paintIndex !== 'number' ||
    !('stopIndex' in target) ||
    typeof target.stopIndex !== 'number'
  ) {
    throw new RangeError('Invalid gradientStops target template')
  }
  return `${target.kind}:${target.paintIndex}:${target.stopIndex}`
}

function effectTargetSignature(target: object): string {
  if (
    !('kind' in target) ||
    (target.kind !== 'blur' && target.kind !== 'shadow') ||
    !('index' in target) ||
    typeof target.index !== 'number'
  ) {
    throw new RangeError('Invalid effects target template')
  }
  return `${target.kind}:${target.index}`
}

function fontAxisTargetSignature(target: object): string {
  if (!('tag' in target) || typeof target.tag !== 'string') {
    throw new RangeError('Invalid fontAxes target template')
  }
  return target.tag
}

function targetSignature(channel: MotionStructuredArrayChannel, target: unknown): string {
  const object = requireTargetObject(channel, target)
  if (channel === 'paints') return paintTargetSignature(object)
  if (channel === 'gradientStops') return gradientStopTargetSignature(object)
  if (channel === 'effects') return effectTargetSignature(object)
  return fontAxisTargetSignature(object)
}

function defaultStructuredValue(
  node: SceneNode,
  channel: MotionStructuredChannel
): MotionKeyframe[MotionStructuredChannel] | undefined {
  return motionAdvancedChannelTemplate(node, channel).value
}

function assertV3(spec: MotionSpec): void {
  if (spec.version !== 3) {
    throw new RangeError('Structured motion channels require an explicit MotionSpec v3 upgrade')
  }
}

function assertNodeCompatible(node: SceneNode, spec: MotionSpec): void {
  const issues = motionStructuredIssues(node, spec)
  if (issues.length > 0) {
    throw new RangeError(
      issues.map((issue) => `${issue.channel}.${issue.path}: ${issue.message}`).join('; ')
    )
  }
}

function editCompatibleMotionStructuredSpec(
  spec: MotionSpec,
  node: SceneNode,
  edit: (draft: MotionSpec) => void
): MotionSpec {
  const next = editAuthoredMotionSpec(spec, edit)
  assertNodeCompatible(node, next)
  return next
}

function requireMotionKeyframeAt(
  spec: MotionSpec,
  trackId: string,
  keyframeIndex: number
): MotionKeyframe {
  const keyframe = requireMotionTrack(spec, trackId).keyframes.at(keyframeIndex)
  if (!keyframe) throw new Error(`Unknown motion keyframe index: ${keyframeIndex}`)
  return keyframe
}

export function setMotionStructuredChannelEnabled(
  spec: MotionSpec,
  node: SceneNode,
  trackId: string,
  channel: MotionStructuredChannel,
  enabled: boolean
): MotionSpec {
  assertV3(spec)
  const initial = defaultStructuredValue(node, channel)
  if (enabled && initial === undefined) {
    throw new RangeError(motionStructuredCapability(node, channel).reason ?? 'Unsupported channel')
  }
  return editCompatibleMotionStructuredSpec(spec, node, (draft) => {
    const track = requireMotionTrack(draft, trackId)
    for (const keyframe of track.keyframes) {
      if (enabled && initial !== undefined) {
        Reflect.set(keyframe, channel, structuredClone(initial))
      } else Reflect.deleteProperty(keyframe, channel)
    }
  })
}

export function updateMotionStructuredChannel(
  spec: MotionSpec,
  node: SceneNode,
  trackId: string,
  keyframeIndex: number,
  channel: MotionStructuredChannel,
  update: (value: NonNullable<MotionKeyframe[MotionStructuredChannel]>) => void
): MotionSpec {
  assertV3(spec)
  return editCompatibleMotionStructuredSpec(spec, node, (draft) => {
    const keyframe = requireMotionKeyframeAt(draft, trackId, keyframeIndex)
    const value = keyframe[channel]
    if (value === undefined) throw new RangeError(`Motion channel ${channel} is not enabled`)
    update(value as NonNullable<MotionKeyframe[MotionStructuredChannel]>)
  })
}

export function updateMotionStructuredScalar(
  spec: MotionSpec,
  node: SceneNode,
  trackId: string,
  keyframeIndex: number,
  channel: 'textReveal',
  value: number
): MotionSpec {
  assertV3(spec)
  return editCompatibleMotionStructuredSpec(spec, node, (draft) => {
    const keyframe = requireMotionKeyframeAt(draft, trackId, keyframeIndex)
    if (keyframe[channel] === undefined) {
      throw new RangeError(`Motion channel ${channel} is not enabled`)
    }
    keyframe[channel] = bounded(value, 0, 1)
  })
}

export function removeMotionStructuredTarget(
  spec: MotionSpec,
  node: SceneNode,
  trackId: string,
  channel: MotionStructuredArrayChannel,
  targetIndex: number
): MotionSpec {
  assertV3(spec)
  return editCompatibleMotionStructuredSpec(spec, node, (draft) => {
    const track = requireMotionTrack(draft, trackId)
    for (const keyframe of track.keyframes) {
      const targets = keyframe[channel]
      if (!targets?.[targetIndex]) throw new RangeError(`Unknown ${channel} target ${targetIndex}`)
      targets.splice(targetIndex, 1)
      if (targets.length === 0) Reflect.deleteProperty(keyframe, channel)
    }
  })
}

export function addMotionStructuredTarget(
  spec: MotionSpec,
  node: SceneNode,
  trackId: string,
  channel: MotionStructuredArrayChannel
): MotionSpec {
  assertV3(spec)
  const track = requireMotionTrack(spec, trackId)
  const current = track.keyframes[0]?.[channel] ?? []
  const used = new Set(current.map((target) => targetSignature(channel, target)))
  const candidate = (motionAdvancedChannelTemplate(node, channel).targets ?? []).find(
    (target) => !used.has(targetSignature(channel, target))
  )
  if (candidate === undefined) {
    throw new RangeError(`No additional ${channel} target is available`)
  }
  return editCompatibleMotionStructuredSpec(spec, node, (draft) => {
    for (const keyframe of requireMotionTrack(draft, trackId).keyframes) {
      const targets: unknown[] = [...(keyframe[channel] ?? [])]
      targets.push(structuredClone(candidate))
      Reflect.set(keyframe, channel, targets)
    }
  })
}
