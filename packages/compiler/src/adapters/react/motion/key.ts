import type { IRMotion, IRMotionEasing, IRMotionKeyframe, IRMotionTrack } from '#compiler/ir/motion'

import { sampleMotionEasing } from '@open-pencil/motion'

// Collection reuses one immutable-by-contract IRMotion object for equivalent nodes. Cache by that
// identity so a large sampled path is canonicalized and hashed once, not once per scan/emission.
const tokenByMotion = new WeakMap<IRMotion, string>()

/** Stable token derived only from canonical, expanded motion behavior. */
export function motionToken(motion: IRMotion): string {
  const cached = tokenByMotion.get(motion)
  if (cached) return cached
  const token = `m-${fnv1a64(canonicalMotion(motion))}`
  tokenByMotion.set(motion, token)
  return token
}

export function easingCSS(easing: IRMotionEasing): string {
  if (typeof easing === 'string') return easing
  if (easing.type === 'cubicBezier') {
    return `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`
  }
  if (easing.type === 'hold') return 'steps(1, end)'
  if (easing.type === 'steps') return `steps(${easing.steps}, ${easing.position})`
  return sampledLinearEasing(easing)
}

/** CSS animation identifiers shared by the stylesheet and WAAPI runtime. */
export function motionCSSAnimationName(token: string, index: number, reduced = false): string {
  return `op-${token}-${index}${reduced ? '-reduced' : ''}`
}

/** Per-track custom property used by the runtime to suppress one declarative
 * animation without disabling sibling tracks on the same element. */
export function motionCSSVariableName(token: string, index: number): string {
  return `--op-${token}-${index}-name`
}

export type MotionCompositionChannel = 'opacity' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotate'

export const MOTION_COMPOSITION_CHANNELS: readonly MotionCompositionChannel[] = [
  'opacity',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotate'
]

/** Numeric custom property animated by one v3 track. The final authored CSS
 * property is assembled separately in stable priority order. */
export function motionCompositionVariableName(
  token: string,
  sourceIndex: number,
  channel: MotionCompositionChannel
): string {
  return `--op-${token}-${sourceIndex}-${channel}`
}

export function motionCompositionClockVariableName(token: string, sourceIndex: number): string {
  return `--op-${token}-${sourceIndex}-clock`
}

/** Runtime-controlled effective weight. It remains zero while a track does not
 * contribute, so inactive replace tracks are neutral instead of replacing with
 * their channel identity. */
export function motionCompositionWeightVariableName(token: string, sourceIndex: number): string {
  return `--op-${token}-${sourceIndex}-weight`
}

export function motionCompositionChannels(track: IRMotionTrack): MotionCompositionChannel[] {
  return MOTION_COMPOSITION_CHANNELS.filter((channel) =>
    track.keyframes.some((frame) => frame[channel] !== undefined)
  )
}

export function compareMotionTrackComposition(left: IRMotionTrack, right: IRMotionTrack): number {
  const priority = (left.composition?.priority ?? 0) - (right.composition?.priority ?? 0)
  return priority !== 0
    ? priority
    : (left.composition?.sourceIndex ?? 0) - (right.composition?.sourceIndex ?? 0)
}

function canonicalMotion(motion: IRMotion): string {
  const tracks = motion.tracks.map((track) => {
    const legacy = [
      track.id,
      track.trigger,
      track.exit,
      track.path
        ? [track.path.points.map((point) => [point.x, point.y]), track.path.autoRotate ?? false]
        : null,
      track.sampledPath ?? false,
      [
        track.timing.durationMs,
        track.timing.delayMs,
        canonicalEasing(track.timing.easing),
        track.timing.iterations,
        track.timing.direction,
        track.timing.fill
      ],
      track.keyframes.map(canonicalKeyframe)
    ]
    return motion.version === 3
      ? [
          ...legacy,
          [
            track.composition?.mode ?? 'replace',
            track.composition?.weight ?? 1,
            track.composition?.priority ?? 0,
            track.composition?.sourceIndex ?? 0
          ]
        ]
      : legacy
  })
  const legacy = [
    motion.version,
    motion.reducedMotion,
    motion.target
      ? [
          motion.target.kind,
          canonicalColor(motion.target.fillColor),
          canonicalNumber(motion.target.fillOpacity),
          canonicalNumber(motion.target.fillIndex),
          canonicalColor(motion.target.strokeColor),
          canonicalNumber(motion.target.strokeOpacity),
          canonicalNumber(motion.target.strokeWidth),
          motion.target.vectorStrokeTarget ?? null,
          canonicalNumber(motion.target.shadowX),
          canonicalNumber(motion.target.shadowY),
          canonicalNumber(motion.target.shadowBlur),
          canonicalNumber(motion.target.shadowSpread),
          canonicalColor(motion.target.shadowColor),
          canonicalNumber(motion.target.blur),
          motion.target.hasShadow ?? false
        ]
      : null,
    tracks
  ]
  return JSON.stringify(
    motion.version === 3
      ? [...legacy, [motion.authoredTransform?.opacity ?? 1, motion.authoredTransform?.rotate ?? 0]]
      : legacy
  )
}

function canonicalKeyframe(frame: IRMotionKeyframe): unknown[] {
  return [
    frame.offset,
    canonicalNumber(frame.opacity),
    canonicalNumber(frame.x),
    canonicalNumber(frame.y),
    canonicalNumber(frame.scaleX),
    canonicalNumber(frame.scaleY),
    canonicalNumber(frame.rotate),
    canonicalNumber(frame.originX),
    canonicalNumber(frame.originY),
    canonicalNumber(frame.width),
    canonicalNumber(frame.height),
    canonicalNumber(frame.cornerRadius),
    canonicalColor(frame.fillColor),
    canonicalColor(frame.strokeColor),
    canonicalNumber(frame.strokeWidth),
    canonicalNumber(frame.blur),
    canonicalNumber(frame.shadowX),
    canonicalNumber(frame.shadowY),
    canonicalNumber(frame.shadowBlur),
    canonicalNumber(frame.shadowSpread),
    canonicalColor(frame.shadowColor),
    canonicalNumber(frame.pathProgress),
    canonicalNumber(frame.trimStart),
    canonicalNumber(frame.trimEnd),
    canonicalNumber(frame.trimOffset),
    canonicalNumber(frame.gap),
    canonicalNumber(frame.rowGap),
    canonicalNumber(frame.columnGap),
    canonicalNumber(frame.paddingTop),
    canonicalNumber(frame.paddingRight),
    canonicalNumber(frame.paddingBottom),
    canonicalNumber(frame.paddingLeft),
    canonicalOptionalEasing(frame.easing)
  ]
}

function canonicalNumber(value: number | undefined): number | null {
  return value === undefined ? null : value
}

function canonicalOptionalEasing(easing: IRMotionEasing | undefined): string | unknown[] | null {
  return easing === undefined ? null : canonicalEasing(easing)
}

function canonicalEasing(easing: IRMotionEasing): string | unknown[] {
  if (typeof easing === 'string') return easing
  if (easing.type === 'cubicBezier') {
    return ['cubicBezier', easing.x1, easing.y1, easing.x2, easing.y2]
  }
  if (easing.type === 'hold') return ['hold']
  if (easing.type === 'steps') return ['steps', easing.steps, easing.position]
  if (easing.type === 'spring') {
    return ['spring', easing.mass, easing.stiffness, easing.damping, easing.velocity]
  }
  if (easing.type === 'inertia') return ['inertia', easing.velocity, easing.deceleration]
  if (easing.type === 'power') return ['power', easing.mode, easing.power]
  if (
    easing.type === 'sine' ||
    easing.type === 'expo' ||
    easing.type === 'circ' ||
    easing.type === 'bounce'
  ) {
    return [easing.type, easing.mode]
  }
  if (easing.type === 'back') return ['back', easing.mode, easing.overshoot]
  return ['elastic', easing.mode, easing.amplitude, easing.period]
}

function canonicalColor(color: IRMotionKeyframe['fillColor']): unknown[] | null {
  return color ? [color.r, color.g, color.b, color.a] : null
}

/** CSS linear() approximates bounded physical and rich curves without a runtime dependency. */
function sampledLinearEasing(
  easing: Extract<
    IRMotionEasing,
    {
      type:
        | 'spring'
        | 'inertia'
        | 'power'
        | 'sine'
        | 'expo'
        | 'circ'
        | 'bounce'
        | 'back'
        | 'elastic'
    }
  >
): string {
  // Elastic frequency and overshoot are authored independently. Scale the finite
  // approximation with both while capping generated CSS size deterministically.
  let segments = 64
  if (easing.type === 'spring' || easing.type === 'inertia') {
    segments = 16
  } else if (easing.type === 'elastic') {
    segments = Math.min(
      512,
      Math.max(
        64,
        Math.ceil(
          ((easing.mode === 'inOut' ? 2 : 1) / easing.period) * 16 * Math.sqrt(easing.amplitude)
        )
      )
    )
  }
  const samples = Array.from({ length: segments + 1 }, (_, index) => {
    const progress = index / segments
    const value = sampleMotionEasing(easing, progress)
    return `${number(value)} ${number(progress * 100)}%`
  })
  return `linear(${samples.join(', ')})`
}

function number(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return String(Math.round(normalized * 1_000_000) / 1_000_000)
}

/** FNV-1a 64-bit; deterministic in Bun/Node/browser and compact enough for attrs. */
function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(36)
}
