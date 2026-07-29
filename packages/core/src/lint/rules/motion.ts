import type {
  GeneratedEffectSpecV1,
  MotionKeyframe,
  MotionPathPoint,
  MotionTrack
} from '@open-pencil/scene-graph'

import { defineRule } from '#core/lint/rule'
import type { RuleContext } from '#core/lint/types'

interface MotionRuleOptions {
  maxDelayMs?: number
  maxDisplacementPx?: number
  maxDurationMs?: number
  maxFiniteTotalMs?: number
  maxKeyframes?: number
  maxRotationDeg?: number
  maxScale?: number
  maxTracks?: number
  maxTransitionsPerSecond?: number
  minOpacityDelta?: number
}

const DEFAULTS = Object.freeze({
  maxDelayMs: 5_000,
  maxDisplacementPx: 1_000,
  maxDurationMs: 10_000,
  maxFiniteTotalMs: 30_000,
  maxKeyframes: 24,
  maxRotationDeg: 360,
  maxScale: 3,
  maxTracks: 4,
  maxTransitionsPerSecond: 3,
  minOpacityDelta: 0.5
})

function options(context: RuleContext): MotionRuleOptions {
  const value = context.getConfig()
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as MotionRuleOptions)
    : {}
}

function positiveOption(
  context: RuleContext,
  name: keyof MotionRuleOptions,
  fallback: number
): number {
  const value = options(context)[name]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function trackIds(tracks: readonly MotionTrack[]): string {
  return tracks.map((track) => `"${track.id}"`).join(', ')
}

function isRepeating(track: MotionTrack): boolean {
  const iterations = track.timing.iterations ?? 1
  return track.trigger === 'loop' || iterations === 'infinite' || iterations > 1
}

function opacityValue(frame: MotionKeyframe): number {
  return frame.opacity ?? 1
}

function pathControlPoints(track: MotionTrack): readonly MotionPathPoint[] {
  const path = track.path
  if (!path) return []
  if (path.version !== 2) return path.points
  return [
    path.start,
    ...path.segments.flatMap((segment) => [segment.control1, segment.control2, segment.end])
  ]
}

function flashingRate(track: MotionTrack, minOpacityDelta: number): number | null {
  if (!track.keyframes.some((frame) => frame.opacity !== undefined)) return null

  const deltas: number[] = []
  for (let index = 1; index < track.keyframes.length; index++) {
    const delta = opacityValue(track.keyframes[index]) - opacityValue(track.keyframes[index - 1])
    if (Math.abs(delta) >= minOpacityDelta) deltas.push(delta)
  }
  if (isRepeating(track)) {
    const first = track.keyframes[0]
    const last = track.keyframes.at(-1)
    if (last) {
      const delta = opacityValue(first) - opacityValue(last)
      if (Math.abs(delta) >= minOpacityDelta) deltas.push(delta)
    }
  }

  const reverses = deltas.some((delta, index) => {
    if (index === 0) return false
    const previous = deltas[index - 1]
    return Math.sign(previous) !== Math.sign(delta)
  })
  if (deltas.length < 2 || !reverses) return null

  return (deltas.length * 1_000) / track.timing.durationMs
}

function generatedEffectFlashingRate(
  effect: GeneratedEffectSpecV1,
  minOpacityDelta: number
): number | null {
  if (effect.params.preset !== 'noise') return null
  const maximumDelta = effect.opacity * effect.params.intensity * effect.params.tint.a
  if (maximumDelta < minOpacityDelta) return null
  return effect.uniforms.time.frequencyHz * Math.abs(effect.uniforms.time.scale)
}

function transformPeaks(track: MotionTrack): {
  displacement: number
  rotation: number
  scale: number
} {
  let displacement = 0
  let rotation = 0
  let scale = 1
  for (const frame of track.keyframes) {
    displacement = Math.max(displacement, Math.hypot(frame.x ?? 0, frame.y ?? 0))
    rotation = Math.max(rotation, Math.abs(frame.rotate ?? 0))
    scale = Math.max(scale, Math.abs(frame.scaleX ?? 1), Math.abs(frame.scaleY ?? 1))
  }
  for (const point of pathControlPoints(track)) {
    displacement = Math.max(displacement, Math.hypot(point.x, point.y))
  }
  return { displacement, rotation, scale }
}

function trackOffender(track: MotionTrack, reasons: Array<string | null>): string[] {
  const activeReasons = reasons.filter((reason): reason is string => reason !== null)
  return activeReasons.length > 0 ? [`"${track.id}": ${activeReasons.join(', ')}`] : []
}

export const motionReducedMotion = defineRule({
  meta: {
    id: 'motion-reduced-motion',
    category: 'accessibility',
    description: 'Motion should reduce or disable when users request reduced motion'
  },
  check(node, context) {
    const motion = node.motion
    if (!motion || motion.reducedMotion === 'reduce' || motion.reducedMotion === 'disable') return
    const policy =
      motion.reducedMotion === 'allow' ? 'explicitly allows full motion' : 'has no policy'
    context.report({
      node,
      message: `Motion ${policy} when reduced motion is requested`,
      suggest: 'Set reducedMotion to "reduce" or "disable"'
    })
  }
})

export const motionTargetCapability = defineRule({
  meta: {
    id: 'motion-target-capability',
    category: 'motion',
    description: 'Motion targets should have renderable geometry in every supported runtime'
  },
  match: ['BOOLEAN_OPERATION'],
  check(node, context) {
    if (!node.motion || node.fillGeometryCount > 0) return
    context.report({
      node,
      message: 'Motion on this Boolean operation has no resolved final geometry',
      suggest:
        'Resolve the Boolean result into fillGeometry before authoring Motion, or clear Motion'
    })
  }
})

export const motionLoopSafety = defineRule({
  meta: {
    id: 'motion-loop-safety',
    category: 'motion',
    description: 'Continuous or infinitely repeating motion should be reviewed'
  },
  check(node, context) {
    const tracks = node.motion?.tracks.filter(
      (track) => track.trigger === 'loop' || track.timing.iterations === 'infinite'
    )
    if (!tracks || tracks.length === 0) return
    context.report({
      node,
      message: `Continuous Motion found on ${trackIds(tracks)}`,
      suggest: 'Prefer a finite interaction or provide an explicit user-controlled stop'
    })
  }
})

export const motionFlashing = defineRule({
  meta: {
    id: 'motion-flashing',
    category: 'accessibility',
    severity: 'error',
    description: 'Avoid rapid, high-contrast opacity reversals and generated noise changes'
  },
  check(node, context) {
    const motion = node.motion
    const minOpacityDelta = positiveOption(context, 'minOpacityDelta', DEFAULTS.minOpacityDelta)
    const maxTransitionsPerSecond = positiveOption(
      context,
      'maxTransitionsPerSecond',
      DEFAULTS.maxTransitionsPerSecond
    )
    if (motion) {
      const offenders = motion.tracks.flatMap((track) => {
        const rate = flashingRate(track, minOpacityDelta)
        return rate !== null && rate > maxTransitionsPerSecond ? [{ track, rate }] : []
      })
      if (offenders.length > 0) {
        const fastest = Math.max(...offenders.map(({ rate }) => rate))
        context.report({
          node,
          message: `Rapid opacity reversals on ${trackIds(offenders.map(({ track }) => track))} reach ${fastest.toFixed(1)} transitions/s`,
          suggest: `Keep substantial opacity reversals at or below ${maxTransitionsPerSecond}/s`
        })
      }
    }

    const generatedEffect = node.generatedEffect
    if (!generatedEffect) return
    const generatedRate = generatedEffectFlashingRate(generatedEffect, minOpacityDelta)
    if (generatedRate === null || generatedRate <= maxTransitionsPerSecond) return
    context.report({
      node,
      message: `Generated noise changes reach ${generatedRate.toFixed(1)} transitions/s with substantial opacity contrast`,
      suggest: `Keep generated noise changes at or below ${maxTransitionsPerSecond}/s, lower opacity or intensity, or use a non-discrete preset`
    })
  }
})

export const motionTransformBounds = defineRule({
  meta: {
    id: 'motion-transform-bounds',
    category: 'motion',
    description: 'Motion transforms should stay within reviewable visual bounds'
  },
  check(node, context) {
    const motion = node.motion
    if (!motion) return
    const maxDisplacementPx = positiveOption(
      context,
      'maxDisplacementPx',
      DEFAULTS.maxDisplacementPx
    )
    const maxRotationDeg = positiveOption(context, 'maxRotationDeg', DEFAULTS.maxRotationDeg)
    const maxScale = positiveOption(context, 'maxScale', DEFAULTS.maxScale)
    const offenders = motion.tracks.flatMap((track) => {
      const peaks = transformPeaks(track)
      return trackOffender(track, [
        peaks.displacement > maxDisplacementPx
          ? `${Math.round(peaks.displacement)}px displacement`
          : null,
        peaks.rotation > maxRotationDeg ? `${Math.round(peaks.rotation)}deg rotation` : null,
        peaks.scale > maxScale ? `${Number(peaks.scale.toFixed(2))}x scale` : null
      ])
    })
    if (offenders.length === 0) return
    context.report({
      node,
      message: `Excessive Motion transform (${offenders.join('; ')})`,
      suggest: 'Reduce displacement, rotation, or scale and retest with reduced motion enabled'
    })
  }
})

export const motionLongTiming = defineRule({
  meta: {
    id: 'motion-long-timing',
    category: 'performance',
    description: 'Motion duration, delay, and finite playback should stay within practical budgets'
  },
  check(node, context) {
    const motion = node.motion
    if (!motion) return
    const maxDurationMs = positiveOption(context, 'maxDurationMs', DEFAULTS.maxDurationMs)
    const maxDelayMs = positiveOption(context, 'maxDelayMs', DEFAULTS.maxDelayMs)
    const maxFiniteTotalMs = positiveOption(context, 'maxFiniteTotalMs', DEFAULTS.maxFiniteTotalMs)
    const offenders = motion.tracks.flatMap((track) => {
      const duration = track.timing.durationMs
      const delay = track.timing.delayMs ?? 0
      const iterations = track.timing.iterations ?? 1
      const total = iterations === 'infinite' ? null : delay + duration * iterations
      return trackOffender(track, [
        duration > maxDurationMs ? `${duration}ms duration` : null,
        delay > maxDelayMs ? `${delay}ms delay` : null,
        total !== null && total > maxFiniteTotalMs ? `${total}ms finite playback` : null
      ])
    })
    if (offenders.length === 0) return
    context.report({
      node,
      message: `Long Motion timing (${offenders.join('; ')})`,
      suggest: 'Shorten the delay, duration, or finite iteration count'
    })
  }
})

export const motionComplexity = defineRule({
  meta: {
    id: 'motion-complexity-budget',
    category: 'performance',
    description: 'Per-node Motion tracks and keyframes should stay within an authoring budget'
  },
  check(node, context) {
    const motion = node.motion
    if (!motion) return
    const maxTracks = positiveOption(context, 'maxTracks', DEFAULTS.maxTracks)
    const maxKeyframes = positiveOption(context, 'maxKeyframes', DEFAULTS.maxKeyframes)
    const keyframes = motion.tracks.reduce((total, track) => total + track.keyframes.length, 0)
    if (motion.tracks.length <= maxTracks && keyframes <= maxKeyframes) return
    context.report({
      node,
      message: `Motion uses ${motion.tracks.length} tracks and ${keyframes} keyframes (budgets: ${maxTracks} tracks, ${maxKeyframes} keyframes)`,
      suggest: 'Merge redundant tracks or remove unnecessary keyframes'
    })
  }
})
