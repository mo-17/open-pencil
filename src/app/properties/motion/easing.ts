import { type MotionEasing, type MotionEasingName, type MotionSpec } from '@open-pencil/scene-graph'

export type MotionEasingKind =
  | MotionEasingName
  | 'cubicBezier'
  | 'power'
  | 'sine'
  | 'expo'
  | 'circ'
  | 'back'
  | 'bounce'
  | 'elastic'
  | 'hold'
  | 'steps'
  | 'spring'
  | 'inertia'

const V1_EASING_KINDS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubicBezier'
] as const satisfies readonly MotionEasingKind[]

const V2_EASING_KINDS = [
  ...V1_EASING_KINDS,
  'power',
  'sine',
  'expo',
  'circ',
  'back',
  'bounce',
  'elastic',
  'hold',
  'steps',
  'spring',
  'inertia'
] as const satisfies readonly MotionEasingKind[]

export function motionEasingKindsForVersion(
  version: MotionSpec['version']
): readonly MotionEasingKind[] {
  return version === 1 ? V1_EASING_KINDS : V2_EASING_KINDS
}

export function motionEasingKind(easing: MotionEasing | undefined): MotionEasingKind {
  if (easing === undefined) return 'ease'
  return typeof easing === 'string' ? easing : easing.type
}

export function createMotionEasing(kind: MotionEasingKind): MotionEasing {
  if (kind === 'cubicBezier') {
    return { type: 'cubicBezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }
  }
  if (kind === 'power') return { type: 'power', mode: 'out', power: 1 }
  if (kind === 'sine') return { type: 'sine', mode: 'out' }
  if (kind === 'expo') return { type: 'expo', mode: 'out' }
  if (kind === 'circ') return { type: 'circ', mode: 'out' }
  if (kind === 'back') return { type: 'back', mode: 'out', overshoot: 1.70158 }
  if (kind === 'bounce') return { type: 'bounce', mode: 'out' }
  if (kind === 'elastic') {
    return { type: 'elastic', mode: 'out', amplitude: 1, period: 0.3 }
  }
  if (kind === 'hold') return { type: 'hold' }
  if (kind === 'steps') return { type: 'steps', steps: 4, position: 'end' }
  if (kind === 'spring') {
    return { type: 'spring', mass: 1, stiffness: 100, damping: 10, velocity: 0 }
  }
  if (kind === 'inertia') return { type: 'inertia', velocity: 0, deceleration: 0.1 }
  return kind
}
