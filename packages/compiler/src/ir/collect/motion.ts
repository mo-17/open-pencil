import {
  type MotionEasing,
  type MotionChannels,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack,
  type SceneNode,
  getMotionChannels,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import type { IRMotion, IRMotionEasing, IRMotionKeyframe, IRMotionTrack } from '../motion'
import type { IRWarning } from '../types'

/** Validate and lower a node's canonical MotionSpec into framework-neutral IR. */
export function collectNodeMotion(node: SceneNode, warnings: IRWarning[]): IRMotion | undefined {
  if (node.motion === undefined) return undefined

  let result: ReturnType<typeof validateMotionSpec>
  try {
    result = validateMotionSpec(node.motion as unknown)
  } catch (error) {
    warnings.push({
      code: 'motion-invalid',
      message: error instanceof Error ? error.message : 'Motion validation failed',
      nodeId: node.id
    })
    return undefined
  }
  if (!result.success) {
    warnings.push({
      code: 'motion-invalid',
      message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      nodeId: node.id
    })
    return undefined
  }

  warnChannelConflicts(result.value, node, warnings)
  if (node.boundVariables.opacity && motionUsesChannel(result.value, 'opacity')) {
    warnings.push({
      code: 'motion-opacity-binding-static',
      message:
        'Motion opacity uses the node static opacity at compile time; the runtime design-token binding is not sampled during animation',
      nodeId: node.id
    })
  }
  return lowerMotion(result.value, nodeOpacity(node))
}

function lowerMotion(spec: MotionSpec, opacity: number): IRMotion {
  return {
    version: 1,
    tracks: spec.tracks.map((track) => lowerTrack(track, opacity)),
    reducedMotion: spec.reducedMotion ?? 'reduce'
  }
}

function lowerTrack(track: MotionTrack, opacity: number): IRMotionTrack {
  const channels = getMotionChannels(track.keyframes)
  return {
    id: track.id,
    trigger: track.trigger,
    keyframes: track.keyframes.map((keyframe) => lowerKeyframe(keyframe, channels, opacity)),
    timing: {
      durationMs: track.timing.durationMs,
      delayMs: track.timing.delayMs ?? 0,
      easing: lowerEasing(track.timing.easing ?? 'ease'),
      iterations: track.timing.iterations ?? (track.trigger === 'loop' ? 'infinite' : 1),
      direction: track.timing.direction ?? 'normal',
      fill: track.timing.fill ?? 'both'
    },
    exit: track.exit ?? 'reset'
  }
}

type MotionChannel = keyof MotionChannels

function warnChannelConflicts(spec: MotionSpec, node: SceneNode, warnings: IRWarning[]): void {
  const owners = new Map<MotionChannel, string[]>()
  for (const track of spec.tracks) {
    const channels = getMotionChannels(track.keyframes)
    for (const channel of Object.keys(channels) as MotionChannel[]) {
      if (!channels[channel]) continue
      const trackIds = owners.get(channel) ?? []
      trackIds.push(track.id)
      owners.set(channel, trackIds)
    }
  }
  for (const [channel, trackIds] of owners) {
    if (trackIds.length < 2) continue
    warnings.push({
      code: 'motion-channel-conflict',
      message: `Motion tracks ${trackIds.join(', ')} all write ${channel}; source order is preserved and the later track wins`,
      nodeId: node.id
    })
  }
}

function motionUsesChannel(spec: MotionSpec, channel: MotionChannel): boolean {
  return spec.tracks.some((track) => getMotionChannels(track.keyframes)[channel])
}

function lowerKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels,
  opacity: number
): IRMotionKeyframe {
  return {
    offset: keyframe.offset,
    ...(channels.opacity ? { opacity: opacity * (keyframe.opacity ?? 1) } : {}),
    ...(channels.translate ? { x: keyframe.x ?? 0, y: keyframe.y ?? 0 } : {}),
    ...(channels.scale ? { scaleX: keyframe.scaleX ?? 1, scaleY: keyframe.scaleY ?? 1 } : {}),
    ...(channels.rotate ? { rotate: keyframe.rotate ?? 0 } : {}),
    ...(keyframe.easing ? { easing: lowerEasing(keyframe.easing) } : {})
  }
}

function lowerEasing(easing: MotionEasing): IRMotionEasing {
  return typeof easing === 'string' ? easing : { ...easing }
}

function nodeOpacity(node: SceneNode): number {
  const opacity =
    typeof node.opacity === 'number' && Number.isFinite(node.opacity) ? node.opacity : 1
  return Math.min(1, Math.max(0, opacity))
}
