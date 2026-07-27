import type { IRMotion, IRMotionEasing, IRMotionKeyframe } from '#compiler/ir/motion'

/** Stable token derived only from canonical, expanded motion behavior. */
export function motionToken(motion: IRMotion): string {
  return `m-${fnv1a64(canonicalMotion(motion))}`
}

export function easingCss(easing: IRMotionEasing): string {
  return typeof easing === 'string'
    ? easing
    : `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`
}

function canonicalMotion(motion: IRMotion): string {
  return JSON.stringify([
    motion.version,
    motion.reducedMotion,
    motion.tracks.map((track) => [
      track.id,
      track.trigger,
      track.exit,
      [
        track.timing.durationMs,
        track.timing.delayMs,
        canonicalEasing(track.timing.easing),
        track.timing.iterations,
        track.timing.direction,
        track.timing.fill
      ],
      track.keyframes.map(canonicalKeyframe)
    ])
  ])
}

function canonicalKeyframe(frame: IRMotionKeyframe): unknown[] {
  return [
    frame.offset,
    frame.opacity ?? null,
    frame.x ?? null,
    frame.y ?? null,
    frame.scaleX ?? null,
    frame.scaleY ?? null,
    frame.rotate ?? null,
    frame.easing ? canonicalEasing(frame.easing) : null
  ]
}

function canonicalEasing(easing: IRMotionEasing): string | unknown[] {
  return typeof easing === 'string'
    ? easing
    : ['cubicBezier', easing.x1, easing.y1, easing.x2, easing.y2]
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
