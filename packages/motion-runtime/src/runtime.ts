import {
  prepareMotionSamplingPlan,
  samplePreparedMotionPlan,
  type MotionSample,
  type MotionSamplingSelection,
  type PreparedMotionSamplingPlan
} from '@open-pencil/core/motion'
import { parseMotionSpec, type MotionSpec } from '@open-pencil/scene-graph'

import { createDefaultMotionClock, type MotionRuntimeClock } from './clock'
import { createMotionFrameLoop, type MotionFrameLoop } from './kernel'

export const MOTION_RUNTIME_LIMITS = Object.freeze({
  maxBindings: 1_024,
  maxIdLength: 128,
  maxPlaybackRate: 16
})

export type MotionPlaybackStatus = 'idle' | 'running' | 'paused' | 'finished' | 'disposed'

export interface MotionRuntimeFrame {
  readonly id: string
  readonly sequence: number
  readonly elapsedMs: number
  readonly timestampMs: number
  readonly playbackRate: number
  readonly sample: MotionSample
}

export interface MotionRuntimeBindingState {
  readonly id: string
  readonly status: MotionPlaybackStatus
  readonly elapsedMs: number
  readonly durationMs: number
  readonly playbackRate: number
  readonly selection: MotionSamplingSelection
}

export interface MotionRuntimeRegistrationOptions {
  readonly id: string
  readonly motion: MotionSpec
  readonly selection?: MotionSamplingSelection
  readonly playbackRate?: number
  readonly apply: (frame: MotionRuntimeFrame) => void
  readonly clear?: () => void
  readonly onFinish?: (state: MotionRuntimeBindingState) => void
}

export interface MotionPlayOptions {
  readonly fromMs?: number
  readonly playbackRate?: number
}

export interface MotionStopOptions {
  readonly clear?: boolean
  readonly reset?: boolean
}

export interface MotionRuntimeOptions {
  readonly clock?: MotionRuntimeClock
  readonly prefersReducedMotion?: boolean
  readonly onError?: (error: unknown, id: string) => void
}

export interface MotionRuntimeHandle {
  readonly id: string
  play(options?: MotionPlayOptions): void
  pause(): void
  resume(): void
  reverse(): void
  seek(elapsedMs: number): MotionRuntimeFrame
  stop(options?: MotionStopOptions): void
  setPlaybackRate(playbackRate: number): void
  update(motion: MotionSpec, selection?: MotionSamplingSelection): void
  getState(): MotionRuntimeBindingState
  dispose(): void
}

interface RuntimeBinding {
  readonly id: string
  readonly order: number
  readonly generation: number
  readonly apply: MotionRuntimeRegistrationOptions['apply']
  readonly clear: MotionRuntimeRegistrationOptions['clear']
  readonly onFinish: MotionRuntimeRegistrationOptions['onFinish']
  motion: MotionSpec
  plan: PreparedMotionSamplingPlan
  selection: MotionSamplingSelection
  status: MotionPlaybackStatus
  elapsedMs: number
  durationMs: number
  normalizedProgress: number | undefined
  positionElapsedMs: number
  hasRendered: boolean
  playbackRate: number
  lastTimestampMs: number
}

function cloneSelection(selection: MotionSamplingSelection): MotionSamplingSelection {
  return selection.mode === 'trackIds'
    ? { mode: 'trackIds', trackIds: [...selection.trackIds] }
    : { ...selection }
}

function validateId(id: string): void {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > MOTION_RUNTIME_LIMITS.maxIdLength ||
    id.includes('\u0000')
  ) {
    throw new RangeError('Motion runtime id must be a non-empty bounded string')
  }
}

function normalizePlaybackRate(value: number): number {
  if (
    !Number.isFinite(value) ||
    value === 0 ||
    Math.abs(value) > MOTION_RUNTIME_LIMITS.maxPlaybackRate
  ) {
    throw new RangeError(
      `Motion playbackRate must be finite, non-zero, and within ±${MOTION_RUNTIME_LIMITS.maxPlaybackRate}`
    )
  }
  return value
}

function planDuration(plan: PreparedMotionSamplingPlan): number {
  let durationMs = 0
  for (const track of plan.tracks) {
    if (track.iterations === 'infinite') return Number.POSITIVE_INFINITY
    durationMs = Math.max(durationMs, track.delayMs + track.durationMs * track.iterations)
  }
  return durationMs
}

function clampElapsed(elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs)) throw new RangeError('Motion elapsed time must be finite')
  return Math.min(Math.max(0, elapsedMs), durationMs)
}

function normalizeReducedMotionPreference(value: boolean | undefined): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new TypeError('Motion prefersReducedMotion must be a boolean')
  }
  return value
}

function captureBindingPosition(binding: RuntimeBinding): void {
  if (Number.isFinite(binding.durationMs) && binding.durationMs > 0) {
    binding.normalizedProgress = binding.elapsedMs / binding.durationMs
    binding.positionElapsedMs = binding.elapsedMs
  } else if (binding.durationMs === Number.POSITIVE_INFINITY) {
    binding.normalizedProgress = undefined
    binding.positionElapsedMs = binding.elapsedMs
  }
}

function remapBindingElapsed(binding: RuntimeBinding, durationMs: number): number {
  captureBindingPosition(binding)
  if (durationMs === 0) return 0
  if (durationMs === Number.POSITIVE_INFINITY) return binding.positionElapsedMs
  if (binding.normalizedProgress !== undefined) {
    return clampElapsed(binding.normalizedProgress * durationMs, durationMs)
  }
  return clampElapsed(binding.positionElapsedMs, durationMs)
}

function stateOf(binding: RuntimeBinding): MotionRuntimeBindingState {
  return Object.freeze({
    id: binding.id,
    status: binding.status,
    elapsedMs: binding.elapsedMs,
    durationMs: binding.durationMs,
    playbackRate: binding.playbackRate,
    selection: cloneSelection(binding.selection)
  })
}

function bindingIsRunning(binding: RuntimeBinding): boolean {
  return binding.status === 'running'
}

function throwCleanupErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return
  if (errors.length === 1) throw errors[0]
  throw new AggregateError(errors, message)
}

/** One bounded, framework-neutral scheduler shared by all registered Motion plans. */
export class MotionRuntime {
  readonly #clock: MotionRuntimeClock
  readonly #onError: MotionRuntimeOptions['onError']
  readonly #bindings = new Map<string, RuntimeBinding>()
  readonly #frameLoop: MotionFrameLoop
  #prefersReducedMotion: boolean
  #nextOrder = 0
  #nextGeneration = 0
  #sequence = 0
  #disposed = false

  constructor(options: MotionRuntimeOptions = {}) {
    this.#clock = options.clock ?? createDefaultMotionClock()
    this.#prefersReducedMotion = normalizeReducedMotionPreference(options.prefersReducedMotion)
    this.#onError = options.onError
    this.#frameLoop = createMotionFrameLoop({
      clock: this.#clock,
      onFrame: (timestampMs) => this.#tick(timestampMs)
    })
  }

  register(options: MotionRuntimeRegistrationOptions): MotionRuntimeHandle {
    this.#assertLive()
    validateId(options.id)
    if (this.#bindings.has(options.id)) {
      throw new RangeError(`Motion runtime id is already registered: ${options.id}`)
    }
    if (this.#bindings.size >= MOTION_RUNTIME_LIMITS.maxBindings) {
      throw new RangeError('Motion runtime binding limit exceeded')
    }
    const selection = cloneSelection(options.selection ?? { mode: 'trigger', trigger: 'mount' })
    const motion = parseMotionSpec(options.motion)
    const plan = this.#prepare(motion, selection)
    const durationMs = planDuration(plan)
    const binding: RuntimeBinding = {
      id: options.id,
      order: this.#nextOrder++,
      generation: ++this.#nextGeneration,
      apply: options.apply,
      clear: options.clear,
      onFinish: options.onFinish,
      motion,
      plan,
      selection,
      status: 'idle',
      elapsedMs: 0,
      durationMs,
      normalizedProgress: durationMs === Number.POSITIVE_INFINITY ? undefined : 0,
      positionElapsedMs: 0,
      hasRendered: false,
      playbackRate: normalizePlaybackRate(options.playbackRate ?? 1),
      lastTimestampMs: this.#clock.now()
    }
    this.#bindings.set(binding.id, binding)
    return this.#handle(binding)
  }

  getState(id: string): MotionRuntimeBindingState | undefined {
    const binding = this.#bindings.get(id)
    return binding ? stateOf(binding) : undefined
  }

  get prefersReducedMotion(): boolean {
    return this.#prefersReducedMotion
  }

  /** Rebuilds every prepared plan in place while retaining playback state and logical position. */
  setPrefersReducedMotion(prefersReducedMotion: boolean): void {
    this.#assertLive()
    const preference = normalizeReducedMotionPreference(prefersReducedMotion)
    if (preference === this.#prefersReducedMotion) return

    const ordered = [...this.#bindings.values()].sort((left, right) => left.order - right.order)
    const rebuilt = ordered.map((binding) => {
      const plan = this.#prepare(binding.motion, binding.selection, preference)
      return { binding, plan, durationMs: planDuration(plan) }
    })
    this.#prefersReducedMotion = preference
    const timestampMs = this.#clock.now()
    for (const { binding, plan, durationMs } of rebuilt) {
      const elapsedMs = remapBindingElapsed(binding, durationMs)
      binding.plan = plan
      binding.durationMs = durationMs
      binding.lastTimestampMs = timestampMs
      if (binding.status !== 'idle' || binding.hasRendered) this.#render(binding, elapsedMs)
      else binding.elapsedMs = elapsedMs
    }
    if (ordered.some((binding) => binding.status === 'running')) this.#requestFrame()
    else this.#cancelFrameWhenIdle()
  }

  dispose(): void {
    if (this.#disposed) return
    const bindings = [...this.#bindings.values()]
    const errors: unknown[] = []

    // Finish observable state before invoking host cleanup callbacks. A callback may re-enter the
    // runtime or throw, but it must not leave another binding live or the runtime half-disposed.
    this.#disposed = true
    this.#bindings.clear()
    for (const binding of bindings) binding.status = 'disposed'

    try {
      this.#frameLoop.dispose()
    } catch (error) {
      errors.push(error)
    }
    for (const binding of bindings) {
      this.#collectClearErrors(binding, errors)
    }
    throwCleanupErrors(errors, 'Motion runtime cleanup failed')
  }

  #prepare(
    motion: MotionSpec,
    selection: MotionSamplingSelection,
    prefersReducedMotion = this.#prefersReducedMotion
  ): PreparedMotionSamplingPlan {
    return prepareMotionSamplingPlan(motion, {
      selection,
      prefersReducedMotion
    })
  }

  #handle(binding: RuntimeBinding): MotionRuntimeHandle {
    const current = () => this.#current(binding)
    const handle: MotionRuntimeHandle = {
      id: binding.id,
      play: (options) => this.#play(current(), options),
      pause: () => this.#pause(current()),
      resume: () => this.#resume(current()),
      reverse: () => this.#reverse(current()),
      seek: (elapsedMs) => this.#render(current(), clampElapsed(elapsedMs, current().durationMs)),
      stop: (options) => this.#stop(current(), options),
      setPlaybackRate: (playbackRate) => {
        current().playbackRate = normalizePlaybackRate(playbackRate)
      },
      update: (motion, selection) => this.#update(current(), motion, selection),
      getState: () => stateOf(current()),
      dispose: () => this.#disposeBinding(binding)
    }
    return Object.freeze(handle)
  }

  #current(binding: RuntimeBinding): RuntimeBinding {
    this.#assertLive()
    if (this.#bindings.get(binding.id) !== binding || binding.status === 'disposed') {
      throw new Error(`Motion runtime binding is disposed: ${binding.id}`)
    }
    return binding
  }

  #play(binding: RuntimeBinding, options: MotionPlayOptions = {}): void {
    if (options.playbackRate !== undefined) {
      binding.playbackRate = normalizePlaybackRate(options.playbackRate)
    }
    if (options.fromMs !== undefined) {
      binding.elapsedMs = clampElapsed(options.fromMs, binding.durationMs)
    } else if (binding.playbackRate > 0 && binding.status === 'finished') {
      binding.elapsedMs = 0
    } else if (
      binding.playbackRate < 0 &&
      binding.elapsedMs === 0 &&
      Number.isFinite(binding.durationMs)
    ) {
      binding.elapsedMs = binding.durationMs
    }
    binding.status = 'running'
    binding.lastTimestampMs = this.#clock.now()
    this.#render(binding, binding.elapsedMs)
    if (bindingIsRunning(binding)) this.#requestFrame()
  }

  #pause(binding: RuntimeBinding): void {
    if (binding.status !== 'running') return
    binding.status = 'paused'
    this.#cancelFrameWhenIdle()
  }

  #resume(binding: RuntimeBinding): void {
    if (binding.status !== 'paused') return
    binding.status = 'running'
    binding.lastTimestampMs = this.#clock.now()
    this.#requestFrame()
  }

  #reverse(binding: RuntimeBinding): void {
    binding.playbackRate = -binding.playbackRate
    if (binding.status === 'finished') {
      if (binding.playbackRate < 0 && Number.isFinite(binding.durationMs)) {
        binding.elapsedMs = binding.durationMs
      } else if (binding.playbackRate > 0) binding.elapsedMs = 0
      binding.status = 'paused'
    }
    if (binding.status === 'running') binding.lastTimestampMs = this.#clock.now()
  }

  #stop(binding: RuntimeBinding, options: MotionStopOptions = {}): void {
    binding.status = 'idle'
    if (options.reset ?? true) binding.elapsedMs = 0
    if (options.clear ?? true) this.#safeClear(binding)
    this.#cancelFrameWhenIdle()
  }

  #update(
    binding: RuntimeBinding,
    motion: MotionSpec,
    requestedSelection?: MotionSamplingSelection
  ): void {
    const selection = cloneSelection(requestedSelection ?? binding.selection)
    const canonicalMotion = parseMotionSpec(motion)
    const plan = this.#prepare(canonicalMotion, selection)
    const durationMs = planDuration(plan)
    const elapsedMs = remapBindingElapsed(binding, durationMs)
    binding.motion = canonicalMotion
    binding.plan = plan
    binding.selection = selection
    binding.durationMs = durationMs
    if (binding.status !== 'idle') this.#render(binding, elapsedMs)
    else binding.elapsedMs = elapsedMs
  }

  #render(binding: RuntimeBinding, elapsedMs: number): MotionRuntimeFrame {
    binding.elapsedMs = elapsedMs
    captureBindingPosition(binding)
    const frame: MotionRuntimeFrame = Object.freeze({
      id: binding.id,
      sequence: ++this.#sequence,
      elapsedMs,
      timestampMs: this.#clock.now(),
      playbackRate: binding.playbackRate,
      sample: samplePreparedMotionPlan(binding.plan, elapsedMs)
    })
    try {
      binding.apply(frame)
      binding.hasRendered = true
    } catch (error) {
      binding.hasRendered = false
      binding.status = 'idle'
      this.#onError?.(error, binding.id)
      if (!this.#onError) throw error
    }
    return frame
  }

  #tick(timestampMs: number): boolean {
    const ordered = [...this.#bindings.values()].sort((left, right) => left.order - right.order)
    for (const binding of ordered) {
      if (binding.status !== 'running') continue
      const deltaMs = Math.max(0, timestampMs - binding.lastTimestampMs)
      binding.lastTimestampMs = timestampMs
      const nextElapsed = clampElapsed(
        binding.elapsedMs + deltaMs * binding.playbackRate,
        binding.durationMs
      )
      const frame = this.#render(binding, nextElapsed)
      if (!bindingIsRunning(binding)) continue
      const finishedForward =
        binding.playbackRate > 0 &&
        (Number.isFinite(binding.durationMs)
          ? nextElapsed >= binding.durationMs
          : frame.sample.finished)
      const finishedReverse = binding.playbackRate < 0 && nextElapsed <= 0
      if (finishedForward || finishedReverse) {
        binding.status = 'finished'
        binding.onFinish?.(stateOf(binding))
      }
    }
    return [...this.#bindings.values()].some((binding) => binding.status === 'running')
  }

  #requestFrame(): void {
    if (!this.#disposed) this.#frameLoop.request()
  }

  #cancelFrame(): void {
    this.#frameLoop.cancel()
  }

  #cancelFrameWhenIdle(): void {
    if (![...this.#bindings.values()].some((binding) => binding.status === 'running')) {
      this.#cancelFrame()
    }
  }

  #safeClear(binding: RuntimeBinding): void {
    try {
      binding.clear?.()
    } catch (error) {
      this.#onError?.(error, binding.id)
      if (!this.#onError) throw error
    } finally {
      binding.hasRendered = false
    }
  }

  #collectClearErrors(binding: RuntimeBinding, errors: unknown[]): void {
    try {
      binding.clear?.()
    } catch (error) {
      errors.push(error)
      try {
        this.#onError?.(error, binding.id)
      } catch (handlerError) {
        errors.push(handlerError)
      }
    }
  }

  #disposeBinding(binding: RuntimeBinding): void {
    if (this.#bindings.get(binding.id) !== binding) return
    this.#bindings.delete(binding.id)
    binding.status = 'disposed'
    const errors: unknown[] = []
    this.#collectClearErrors(binding, errors)
    try {
      this.#cancelFrameWhenIdle()
    } catch (error) {
      errors.push(error)
    }
    throwCleanupErrors(errors, `Motion runtime binding cleanup failed: ${binding.id}`)
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('Motion runtime is disposed')
  }
}

export function createMotionRuntime(options?: MotionRuntimeOptions): MotionRuntime {
  return new MotionRuntime(options)
}
