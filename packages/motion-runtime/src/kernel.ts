import type { MotionRuntimeClock } from './clock'

export type MotionKernelSamplingChannel = 'opacity' | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotate'

export const MOTION_KERNEL_SAMPLING_CHANNELS: readonly MotionKernelSamplingChannel[] =
  Object.freeze(['opacity', 'x', 'y', 'scaleX', 'scaleY', 'rotate'])

export type MotionKernelEasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type MotionKernelEasing =
  | MotionKernelEasingName
  | { type: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'hold' }
  | { type: 'steps'; steps: number; position: 'start' | 'end' }
  | { type: 'spring'; mass: number; stiffness: number; damping: number; velocity: number }
  | { type: 'inertia'; velocity: number; deceleration: number }

export interface MotionKernelSamplingFrame {
  readonly offset: number
  readonly values: Partial<Record<MotionKernelSamplingChannel, number>>
  readonly easing?: MotionKernelEasing
}

export interface MotionKernelTrack {
  readonly timing: {
    readonly duration: number
    readonly delay: number
    readonly iterations: number | 'infinite'
    readonly direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
    readonly fill: 'none' | 'forwards' | 'backwards' | 'both'
  }
  readonly composition?: {
    readonly sampling: {
      readonly easing: MotionKernelEasing
      readonly keyframes: readonly MotionKernelSamplingFrame[]
    }
  }
}

export interface MotionKernelTrackProgress {
  readonly contributes: boolean
  readonly progress: number
  readonly completedIterations: number
}

export function motionSamplingIdentity(channel: MotionKernelSamplingChannel): number {
  return channel === 'opacity' || channel === 'scaleX' || channel === 'scaleY' ? 1 : 0
}

function namedEasingControls(
  easing: MotionKernelEasingName
): readonly [number, number, number, number] {
  if (easing === 'ease') return [0.25, 0.1, 0.25, 1]
  if (easing === 'ease-in') return [0.42, 0, 1, 1]
  if (easing === 'ease-out') return [0, 0, 0.58, 1]
  if (easing === 'ease-in-out') return [0.42, 0, 0.58, 1]
  return [0, 0, 1, 1]
}

function cubicCoordinate(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
}

function cubicDerivative(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return (
    3 * inverse * inverse * first + 6 * inverse * t * (second - first) + 3 * t * t * (1 - second)
  )
}

function solveCurveX(progress: number, x1: number, x2: number): number {
  let estimate = progress
  for (let iteration = 0; iteration < 8; iteration++) {
    const error = cubicCoordinate(estimate, x1, x2) - progress
    if (Math.abs(error) < 1e-7) return estimate
    const derivative = cubicDerivative(estimate, x1, x2)
    if (Math.abs(derivative) < 1e-7) break
    const next = estimate - error / derivative
    if (next < 0 || next > 1) break
    estimate = next
  }
  let lower = 0
  let upper = 1
  for (let iteration = 0; iteration < 20; iteration++) {
    estimate = (lower + upper) / 2
    if (cubicCoordinate(estimate, x1, x2) < progress) lower = estimate
    else upper = estimate
  }
  return estimate
}

/** Zero-dependency easing sampler shared by the public and generated runtimes. */
export function sampleMotionRuntimeEasing(easing: MotionKernelEasing, progress: number): number {
  const normalized = Math.min(1, Math.max(0, progress))
  if (normalized === 0 || normalized === 1 || easing === 'linear') return normalized
  if (typeof easing === 'object') {
    if (easing.type === 'hold') return 0
    if (easing.type === 'steps') {
      const stepped =
        easing.position === 'start'
          ? Math.ceil(normalized * easing.steps)
          : Math.floor(normalized * easing.steps)
      return Math.min(1, Math.max(0, stepped / easing.steps))
    }
    if (easing.type === 'spring') {
      const angular = Math.sqrt(easing.stiffness / easing.mass)
      const dampingRatio = easing.damping / (2 * Math.sqrt(easing.stiffness * easing.mass))
      if (dampingRatio < 1) {
        const damped = angular * Math.sqrt(1 - dampingRatio * dampingRatio)
        const coefficient = (dampingRatio * angular - easing.velocity) / damped
        return (
          1 -
          Math.exp(-dampingRatio * angular * normalized) *
            (Math.cos(damped * normalized) + coefficient * Math.sin(damped * normalized))
        )
      }
      if (Math.abs(dampingRatio - 1) < 1e-6) {
        return 1 - Math.exp(-angular * normalized) * (1 + (angular - easing.velocity) * normalized)
      }
      const root = Math.sqrt(dampingRatio * dampingRatio - 1)
      const first = -angular * (dampingRatio - root)
      const second = -angular * (dampingRatio + root)
      const secondWeight = (easing.velocity - first) / (first - second)
      const firstWeight = 1 - secondWeight
      return (
        1 -
        firstWeight * Math.exp(first * normalized) -
        secondWeight * Math.exp(second * normalized)
      )
    }
    if (easing.type === 'inertia') {
      const rate = Math.max(0.0001, easing.deceleration * 12 + Math.abs(easing.velocity) * 0.002)
      const denominator = 1 - Math.exp(-rate)
      const decay =
        denominator === 0 ? normalized : (1 - Math.exp(-rate * normalized)) / denominator
      const velocityBias = easing.velocity * 0.0005 * normalized * (1 - normalized)
      return Math.min(1, Math.max(0, decay + velocityBias))
    }
  }
  const controls =
    typeof easing === 'string'
      ? namedEasingControls(easing)
      : ([easing.x1, easing.y1, easing.x2, easing.y2] as const)
  const parameter = solveCurveX(normalized, controls[0], controls[2])
  return cubicCoordinate(parameter, controls[1], controls[3])
}

function samplingFrameValue(
  frame: MotionKernelSamplingFrame,
  channel: MotionKernelSamplingChannel
): number {
  return frame.values[channel] ?? motionSamplingIdentity(channel)
}

/** Samples one lowered composition channel without a compiler-IR dependency. */
export function sampleMotionRuntimeChannel(
  track: MotionKernelTrack,
  channel: MotionKernelSamplingChannel,
  progress: number
): number {
  const sampling = track.composition?.sampling
  if (!sampling) return motionSamplingIdentity(channel)
  const keyframes = sampling.keyframes
  if (keyframes.length === 0) return motionSamplingIdentity(channel)
  let startIndex = 0
  for (let index = 1; index < keyframes.length; index++) {
    if (keyframes[index].offset > progress) break
    startIndex = index
  }
  const start = keyframes[startIndex]
  if (startIndex === keyframes.length - 1) return samplingFrameValue(start, channel)
  const end = keyframes[startIndex + 1]
  const span = end.offset - start.offset
  if (span <= 0) return samplingFrameValue(end, channel)
  const localProgress = (progress - start.offset) / span
  const eased = sampleMotionRuntimeEasing(start.easing ?? sampling.easing, localProgress)
  const from = samplingFrameValue(start, channel)
  return from + (samplingFrameValue(end, channel) - from) * eased
}

function directedProgress(
  progress: number,
  iteration: number,
  direction: MotionKernelTrack['timing']['direction']
): number {
  const reversed =
    direction === 'reverse' ||
    (direction === 'alternate' && iteration % 2 === 1) ||
    (direction === 'alternate-reverse' && iteration % 2 === 0)
  return reversed ? 1 - progress : progress
}

function endProgress(
  iterations: number,
  direction: MotionKernelTrack['timing']['direction']
): number {
  const wholeIterations = Math.floor(iterations)
  const remainder = iterations - wholeIterations
  const iteration = remainder === 0 ? Math.max(0, wholeIterations - 1) : wholeIterations
  return directedProgress(remainder === 0 ? 1 : remainder, iteration, direction)
}

/** Resolves fill, direction, fractional iterations, and accumulation count. */
export function motionRuntimeTrackProgress(
  track: MotionKernelTrack,
  elapsedMs: number
): MotionKernelTrackProgress {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const { delay, duration, iterations, direction, fill } = track.timing
  if (elapsed < delay) {
    return {
      contributes: fill === 'backwards' || fill === 'both',
      progress: directedProgress(0, 0, direction),
      completedIterations: 0
    }
  }
  const activeTime = elapsed - delay
  if (iterations !== 'infinite' && activeTime >= duration * iterations) {
    return {
      contributes: fill === 'forwards' || fill === 'both',
      progress: endProgress(iterations, direction),
      completedIterations: Math.max(0, Math.ceil(iterations) - 1)
    }
  }
  const iteration = duration > 0 ? Math.floor(activeTime / duration) : 0
  return {
    contributes: true,
    progress:
      duration > 0
        ? directedProgress((activeTime % duration) / duration, iteration, direction)
        : endProgress(iterations === 'infinite' ? 1 : iterations, direction),
    completedIterations: iteration
  }
}

export interface MotionFrameLoopOptions {
  readonly clock: MotionRuntimeClock
  /** Return true to request the next shared frame. */
  readonly onFrame: (timestampMs: number) => boolean
}

export interface MotionFrameLoop {
  readonly scheduled: boolean
  request(): void
  cancel(): void
  dispose(): void
}

/** One cancellation-safe rAF/timer loop. Safe when a clock invokes callbacks synchronously. */
export function createMotionFrameLoop(options: MotionFrameLoopOptions): MotionFrameLoop {
  const noFrame = Symbol('no-motion-frame')
  const requestingFrame = Symbol('requesting-motion-frame')
  const clock = options.clock
  let handle: unknown = noFrame
  let token = 0
  let disposed = false

  const loop: MotionFrameLoop = {
    get scheduled() {
      return handle !== noFrame
    },
    request() {
      if (disposed || handle !== noFrame) return
      const requestToken = ++token
      handle = requestingFrame
      const requested = clock.requestFrame((timestampMs) => {
        if (disposed || requestToken !== token) return
        handle = noFrame
        const normalized = Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : clock.now()
        if (options.onFrame(normalized)) loop.request()
      })
      if (handle === requestingFrame) handle = requested
    },
    cancel() {
      const pending = handle
      if (pending === noFrame) return
      ++token
      handle = noFrame
      if (pending !== requestingFrame) clock.cancelFrame(pending)
    },
    dispose() {
      if (disposed) return
      loop.cancel()
      disposed = true
    }
  }
  return Object.freeze(loop)
}

function functionSource(fn: (...args: never[]) => unknown): string {
  return Function.prototype.toString.call(fn)
}

function typedFunctionSource(
  name: string,
  signature: string,
  fn: (...args: never[]) => unknown
): string {
  return `const ${name}: ${signature} = ${functionSource(fn)}`
}

function emittedFunctionName(fn: (...args: never[]) => unknown, fallback: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(fn.name) ? fn.name : fallback
}

/**
 * Emits the exact pure kernel implementation used by this package. The React
 * compiler embeds it so generated projects stay dependency-free while their
 * scheduler and sampling behavior cannot drift from the public SDK.
 */
export function buildMotionRuntimeKernelSource(): string {
  const identityName = emittedFunctionName(motionSamplingIdentity, 'motionSamplingIdentity')
  const namedEasingName = emittedFunctionName(namedEasingControls, 'namedEasingControls')
  const coordinateName = emittedFunctionName(cubicCoordinate, 'cubicCoordinate')
  const derivativeName = emittedFunctionName(cubicDerivative, 'cubicDerivative')
  const solveName = emittedFunctionName(solveCurveX, 'solveCurveX')
  const easingName = emittedFunctionName(sampleMotionRuntimeEasing, 'sampleMotionRuntimeEasing')
  const frameValueName = emittedFunctionName(samplingFrameValue, 'samplingFrameValue')
  const channelName = emittedFunctionName(sampleMotionRuntimeChannel, 'sampleMotionRuntimeChannel')
  const directedName = emittedFunctionName(directedProgress, 'directedProgress')
  const endName = emittedFunctionName(endProgress, 'endProgress')
  const progressName = emittedFunctionName(motionRuntimeTrackProgress, 'motionRuntimeTrackProgress')
  const frameLoopName = emittedFunctionName(createMotionFrameLoop, 'createMotionFrameLoop')
  return [
    '/* Embedded from @open-pencil/motion-runtime/kernel. */',
    `interface EmbeddedMotionTrackProgress {
  readonly contributes: boolean
  readonly progress: number
  readonly completedIterations: number
}`,
    `interface EmbeddedMotionFrameLoopOptions {
  readonly clock: {
    now(): number
    requestFrame(callback: (timestampMs: number) => void): unknown
    cancelFrame(handle: unknown): void
  }
  readonly onFrame: (timestampMs: number) => boolean
}`,
    `interface EmbeddedMotionFrameLoop {
  readonly scheduled: boolean
  request(): void
  cancel(): void
  dispose(): void
}`,
    `interface EmbeddedMotionKernel {
  readonly motionSamplingIdentity: (channel: MotionSamplingChannel) => number
  readonly sampleMotionRuntimeEasing: (
    easing: MotionSamplingEasing,
    progress: number
  ) => number
  readonly sampleMotionRuntimeChannel: (
    track: MotionTrack,
    channel: MotionSamplingChannel,
    progress: number
  ) => number
  readonly motionRuntimeTrackProgress: (
    track: MotionTrack,
    elapsedMs: number
  ) => EmbeddedMotionTrackProgress
  readonly createMotionFrameLoop: (
    options: EmbeddedMotionFrameLoopOptions
  ) => EmbeddedMotionFrameLoop
}`,
    'const embeddedMotionKernel: EmbeddedMotionKernel = (() => {',
    typedFunctionSource(
      identityName,
      '(channel: MotionSamplingChannel) => number',
      motionSamplingIdentity
    ),
    typedFunctionSource(
      namedEasingName,
      '(easing: MotionEasingName) => readonly [number, number, number, number]',
      namedEasingControls
    ),
    typedFunctionSource(
      coordinateName,
      '(t: number, first: number, second: number) => number',
      cubicCoordinate
    ),
    typedFunctionSource(
      derivativeName,
      '(t: number, first: number, second: number) => number',
      cubicDerivative
    ),
    typedFunctionSource(
      solveName,
      '(progress: number, x1: number, x2: number) => number',
      solveCurveX
    ),
    typedFunctionSource(
      easingName,
      '(easing: MotionSamplingEasing, progress: number) => number',
      sampleMotionRuntimeEasing
    ),
    typedFunctionSource(
      frameValueName,
      '(frame: MotionSamplingFrame, channel: MotionSamplingChannel) => number',
      samplingFrameValue
    ),
    typedFunctionSource(
      channelName,
      '(track: MotionTrack, channel: MotionSamplingChannel, progress: number) => number',
      sampleMotionRuntimeChannel
    ),
    typedFunctionSource(
      directedName,
      "(progress: number, iteration: number, direction: MotionTrack['timing']['direction']) => number",
      directedProgress
    ),
    typedFunctionSource(
      endName,
      "(iterations: number, direction: MotionTrack['timing']['direction']) => number",
      endProgress
    ),
    typedFunctionSource(
      progressName,
      '(track: MotionTrack, elapsedMs: number) => EmbeddedMotionTrackProgress',
      motionRuntimeTrackProgress
    ),
    typedFunctionSource(
      frameLoopName,
      '(options: EmbeddedMotionFrameLoopOptions) => EmbeddedMotionFrameLoop',
      createMotionFrameLoop
    ),
    `return {
  motionSamplingIdentity: ${identityName},
  sampleMotionRuntimeEasing: ${easingName},
  sampleMotionRuntimeChannel: ${channelName},
  motionRuntimeTrackProgress: ${progressName},
  createMotionFrameLoop: ${frameLoopName}
}`,
    '})()',
    `const sharedMotionSamplingChannels: readonly MotionSamplingChannel[] = Object.freeze(${JSON.stringify(MOTION_KERNEL_SAMPLING_CHANNELS)})`,
    'const sharedMotionSamplingIdentity = embeddedMotionKernel.motionSamplingIdentity',
    'const sharedSampleMotionRuntimeChannel = embeddedMotionKernel.sampleMotionRuntimeChannel',
    'const sharedSampleMotionRuntimeEasing = embeddedMotionKernel.sampleMotionRuntimeEasing',
    'const sharedMotionRuntimeTrackProgress = embeddedMotionKernel.motionRuntimeTrackProgress',
    'const createMotionFrameLoop = embeddedMotionKernel.createMotionFrameLoop'
  ].join('\n\n')
}
