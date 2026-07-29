import {
  parseMotionDriverSpec,
  type MotionDriverSource,
  type MotionDriverSpecV1,
  type MotionTrigger
} from '@open-pencil/scene-graph'

import {
  mapMotionDriverInput,
  normalizeMotionStateInput,
  type MotionInputValue
} from './driver/mapping'
import {
  prepareMotionDriverTarget,
  samplePreparedMotionDriverTarget,
  type MotionDriverPlanIssue,
  type MotionInputTargetResolver,
  type PreparedMotionDriverTarget
} from './driver/sampler'
import type { MotionSample } from './types'

export const MOTION_INPUT_CONTROLLER_LIMITS = Object.freeze({
  maxScopes: 32,
  maxTotalDrivers: 2_048,
  maxScopeIdLength: 128
})

export interface MotionInputKey {
  readonly scopeId: string
  readonly driverId: string
}

export interface MotionInputFrameScheduler {
  request(callback: () => void): unknown
  cancel(handle: unknown): void
}

export interface MotionInputTargetState {
  readonly targetNodeId: string
  readonly resolvedNodeId: string
  readonly trackId: string
  readonly authoredTrigger: MotionTrigger
  readonly automaticTriggerSuppressed: true
}

interface MotionInputOutputBase {
  readonly scopeId: string
  readonly driverId: string
  readonly sourceKind: MotionDriverSource['kind']
  readonly input: number
  readonly target: MotionInputTargetState
}

export interface MotionInputSampleOutput extends MotionInputOutputBase {
  readonly active: true
  readonly progress: number
  readonly elapsedMs: number
  readonly sample: MotionSample
}

export interface MotionInputInactiveOutput extends MotionInputOutputBase {
  readonly active: false
  readonly reason: 'out-of-range'
}

export type MotionInputOutput = MotionInputSampleOutput | MotionInputInactiveOutput

export interface MotionInputBatch {
  readonly sequence: number
  readonly outputs: readonly MotionInputOutput[]
}

export interface MotionInputScopeState {
  readonly scopeId: string
  readonly automaticTriggerSuppressions: readonly MotionInputTargetState[]
  readonly outputs: readonly MotionInputOutput[]
}

export interface MotionInputScopeCleanup {
  readonly scopeId: string
  /** Targets whose last published output was active and must be cleared by the host. */
  readonly clearTargets: readonly MotionInputTargetState[]
}

export interface MotionInputRegistration {
  readonly scopeId: string
  readonly driverIds: readonly string[]
  readonly issues: readonly MotionDriverPlanIssue[]
  /** Active targets released by replacing an earlier registration with the same scope id. */
  readonly replacedClearTargets: readonly MotionInputTargetState[]
  dispose(): MotionInputScopeCleanup | undefined
}

export interface MotionInputControllerOptions {
  readonly scheduler?: MotionInputFrameScheduler
  readonly prefersReducedMotion?: boolean
  readonly onUpdate?: (batch: MotionInputBatch) => void
}

interface RegisteredDriver {
  readonly scopeId: string
  readonly scopeOrder: number
  readonly driverOrder: number
  readonly target: PreparedMotionDriverTarget
  readonly targetState: MotionInputTargetState
}

interface PendingInput {
  readonly input: number
  readonly progress?: number
}

interface RegisteredScope {
  readonly id: string
  readonly generation: number
  readonly order: number
  readonly driverCount: number
  readonly drivers: ReadonlyMap<string, RegisteredDriver>
  readonly outputs: Map<string, MotionInputOutput>
}

const NO_FRAME = Symbol('no-motion-input-frame')
const REQUESTING_FRAME = Symbol('requesting-motion-input-frame')

function defaultFrameScheduler(): MotionInputFrameScheduler {
  if (
    typeof globalThis.requestAnimationFrame === 'function' &&
    typeof globalThis.cancelAnimationFrame === 'function'
  ) {
    return {
      request: (callback) => globalThis.requestAnimationFrame(() => callback()),
      cancel: (handle) => globalThis.cancelAnimationFrame(handle as number)
    }
  }
  return {
    request: (callback) => globalThis.setTimeout(callback, 16),
    cancel: (handle) => globalThis.clearTimeout(handle as number)
  }
}

function validateScopeId(scopeId: string): void {
  if (
    typeof scopeId !== 'string' ||
    scopeId.length === 0 ||
    scopeId.length > MOTION_INPUT_CONTROLLER_LIMITS.maxScopeIdLength ||
    scopeId.includes('\u0000')
  ) {
    throw new RangeError('Motion input scopeId must be a non-empty bounded string')
  }
}

function targetState(target: PreparedMotionDriverTarget): MotionInputTargetState {
  return Object.freeze({
    targetNodeId: target.targetNodeId,
    resolvedNodeId: target.resolvedNodeId,
    trackId: target.trackId,
    authoredTrigger: target.authoredTrigger,
    automaticTriggerSuppressed: true
  })
}

function compareDrivers(left: RegisteredDriver, right: RegisteredDriver): number {
  return left.scopeOrder - right.scopeOrder || left.driverOrder - right.driverOrder
}

/** Framework-neutral coordinator for bounded continuous Motion inputs. */
export class MotionInputController {
  readonly #scheduler: MotionInputFrameScheduler
  readonly #prefersReducedMotion: boolean
  readonly #onUpdate: ((batch: MotionInputBatch) => void) | undefined
  readonly #scopes = new Map<string, RegisteredScope>()
  readonly #driverIndex = new Map<string, Map<string, RegisteredDriver>>()
  readonly #pending = new Map<RegisteredDriver, PendingInput>()
  #frameHandle: unknown = NO_FRAME
  #frameToken = 0
  #nextScopeOrder = 0
  #nextGeneration = 0
  #totalDrivers = 0
  #sequence = 0
  #disposed = false

  constructor(options: MotionInputControllerOptions = {}) {
    this.#scheduler = options.scheduler ?? defaultFrameScheduler()
    this.#prefersReducedMotion = options.prefersReducedMotion ?? false
    this.#onUpdate = options.onUpdate
  }

  register(
    scopeId: string,
    value: MotionDriverSpecV1,
    resolveTarget: MotionInputTargetResolver
  ): MotionInputRegistration {
    this.#assertLive()
    validateScopeId(scopeId)
    const spec = parseMotionDriverSpec(value)
    const current = this.#scopes.get(scopeId)
    const nextScopeCount = this.#scopes.size + (current ? 0 : 1)
    if (nextScopeCount > MOTION_INPUT_CONTROLLER_LIMITS.maxScopes) {
      throw new RangeError('Motion input controller scope limit exceeded')
    }
    const nextDriverCount = this.#totalDrivers - (current?.driverCount ?? 0) + spec.drivers.length
    if (nextDriverCount > MOTION_INPUT_CONTROLLER_LIMITS.maxTotalDrivers) {
      throw new RangeError('Motion input controller driver limit exceeded')
    }

    const order = current?.order ?? this.#nextScopeOrder++
    const generation = ++this.#nextGeneration
    const drivers = new Map<string, RegisteredDriver>()
    const issues: MotionDriverPlanIssue[] = []
    for (let driverOrder = 0; driverOrder < spec.drivers.length; driverOrder++) {
      const driver = spec.drivers[driverOrder]
      const preparation = prepareMotionDriverTarget(driver, resolveTarget, {
        prefersReducedMotion: this.#prefersReducedMotion
      })
      if (!preparation.success) {
        issues.push(preparation.issue)
        continue
      }
      const registered: RegisteredDriver = {
        scopeId,
        scopeOrder: order,
        driverOrder,
        target: preparation.target,
        targetState: targetState(preparation.target)
      }
      drivers.set(driver.id, registered)
    }

    const replacedClearTargets = current ? this.#removeScope(current) : []
    const scope: RegisteredScope = {
      id: scopeId,
      generation,
      order,
      driverCount: spec.drivers.length,
      drivers,
      outputs: new Map<string, MotionInputOutput>()
    }
    this.#scopes.set(scopeId, scope)
    this.#totalDrivers += scope.driverCount
    for (const [driverId, driver] of drivers) {
      const indexed = this.#driverIndex.get(driverId) ?? new Map<string, RegisteredDriver>()
      indexed.set(scopeId, driver)
      this.#driverIndex.set(driverId, indexed)
    }

    return {
      scopeId,
      driverIds: Object.freeze([...drivers.keys()]),
      issues: Object.freeze([...issues]),
      replacedClearTargets,
      dispose: () => this.#disposeRegistration(scopeId, generation)
    }
  }

  setInput(driverId: string, value: MotionInputValue): boolean
  setInput(key: MotionInputKey, value: MotionInputValue): boolean
  setInput(keyOrDriverId: MotionInputKey | string, value: MotionInputValue): boolean {
    this.#assertLive()
    const driver = this.#resolveDriver(keyOrDriverId)
    if (!driver) return false
    const input = normalizeMotionStateInput(value)
    const progress = mapMotionDriverInput(input, driver.target.driver.mapping)
    this.#pending.set(driver, progress === undefined ? { input } : { input, progress })
    this.#requestFrame()
    return true
  }

  flush(): MotionInputBatch {
    this.#assertLive()
    this.#cancelFrame()
    return this.#drainPending()
  }

  getScopeState(scopeId: string): MotionInputScopeState | undefined {
    const scope = this.#scopes.get(scopeId)
    if (!scope) return undefined
    const orderedDrivers = [...scope.drivers.values()].sort(compareDrivers)
    return {
      scopeId,
      automaticTriggerSuppressions: Object.freeze(
        orderedDrivers.map((driver) => driver.targetState)
      ),
      outputs: Object.freeze(
        orderedDrivers.flatMap((driver) => {
          const output = scope.outputs.get(driver.target.driver.id)
          return output ? [output] : []
        })
      )
    }
  }

  isAutomaticTriggerSuppressed(scopeId: string, targetNodeId: string, trackId: string): boolean {
    const scope = this.#scopes.get(scopeId)
    if (!scope) return false
    for (const driver of scope.drivers.values()) {
      if (driver.target.targetNodeId === targetNodeId && driver.target.trackId === trackId)
        return true
    }
    return false
  }

  disposeScope(scopeId: string): MotionInputScopeCleanup | undefined {
    const scope = this.#scopes.get(scopeId)
    if (!scope) return undefined
    return { scopeId, clearTargets: this.#removeScope(scope) }
  }

  dispose(): readonly MotionInputScopeCleanup[] {
    if (this.#disposed) return []
    this.#cancelFrame()
    const cleanups: MotionInputScopeCleanup[] = []
    while (this.#scopes.size > 0) {
      const scope = this.#scopes.values().next().value
      if (!scope) break
      cleanups.push({ scopeId: scope.id, clearTargets: this.#removeScope(scope) })
    }
    this.#disposed = true
    return Object.freeze(cleanups)
  }

  #resolveDriver(keyOrDriverId: MotionInputKey | string): RegisteredDriver | undefined {
    if (typeof keyOrDriverId !== 'string') {
      return this.#scopes.get(keyOrDriverId.scopeId)?.drivers.get(keyOrDriverId.driverId)
    }
    const matches = this.#driverIndex.get(keyOrDriverId)
    if (!matches || matches.size === 0) return undefined
    if (matches.size > 1) {
      throw new RangeError(`Motion input driverId is ambiguous across scopes: ${keyOrDriverId}`)
    }
    return matches.values().next().value
  }

  #requestFrame(): void {
    if (this.#frameHandle !== NO_FRAME) return
    const token = ++this.#frameToken
    this.#frameHandle = REQUESTING_FRAME
    const handle = this.#scheduler.request(() => {
      if (this.#frameToken !== token) return
      this.#frameHandle = NO_FRAME
      this.#drainPending()
    })
    if (this.#frameHandle === REQUESTING_FRAME) this.#frameHandle = handle
  }

  #cancelFrame(): void {
    const handle = this.#frameHandle
    if (handle === NO_FRAME) return
    ++this.#frameToken
    this.#frameHandle = NO_FRAME
    if (handle !== REQUESTING_FRAME) this.#scheduler.cancel(handle)
  }

  #drainPending(): MotionInputBatch {
    const entries = [...this.#pending.entries()].sort(([left], [right]) =>
      compareDrivers(left, right)
    )
    this.#pending.clear()
    const outputs: MotionInputOutput[] = []
    for (const [driver, pending] of entries) {
      const scope = this.#scopes.get(driver.scopeId)
      if (scope?.drivers.get(driver.target.driver.id) !== driver) continue
      const base: MotionInputOutputBase = {
        scopeId: driver.scopeId,
        driverId: driver.target.driver.id,
        sourceKind: driver.target.driver.source.kind,
        input: pending.input,
        target: driver.targetState
      }
      const output: MotionInputOutput = Object.freeze(
        pending.progress === undefined
          ? { ...base, active: false, reason: 'out-of-range' }
          : {
              ...base,
              active: true,
              ...samplePreparedMotionDriverTarget(driver.target, pending.progress)
            }
      )
      scope.outputs.set(driver.target.driver.id, output)
      outputs.push(output)
    }
    const batch: MotionInputBatch = Object.freeze({
      sequence: outputs.length > 0 ? ++this.#sequence : this.#sequence,
      outputs: Object.freeze(outputs)
    })
    if (outputs.length > 0) this.#onUpdate?.(batch)
    return batch
  }

  #removeScope(scope: RegisteredScope): readonly MotionInputTargetState[] {
    const clearTargets = [...scope.outputs.values()].flatMap((output) =>
      output.active ? [output.target] : []
    )
    for (const [driverId, driver] of scope.drivers) {
      this.#pending.delete(driver)
      const indexed = this.#driverIndex.get(driverId)
      indexed?.delete(scope.id)
      if (indexed?.size === 0) this.#driverIndex.delete(driverId)
    }
    this.#scopes.delete(scope.id)
    this.#totalDrivers -= scope.driverCount
    if (this.#pending.size === 0) this.#cancelFrame()
    return Object.freeze(clearTargets)
  }

  #disposeRegistration(scopeId: string, generation: number): MotionInputScopeCleanup | undefined {
    const scope = this.#scopes.get(scopeId)
    if (!scope || scope.generation !== generation) return undefined
    return { scopeId, clearTargets: this.#removeScope(scope) }
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('Motion input controller is disposed')
  }
}
