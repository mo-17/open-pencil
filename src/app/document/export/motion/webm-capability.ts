import {
  getMotionExportCapabilities,
  MotionExportCancelledError,
  planGraphMotionExport,
  type MotionAnimationEncoder,
  type MotionExportCapability,
  type MotionGraphExportPlan,
  type PlanGraphMotionExportOptions
} from '@open-pencil/core/io/motion-export'

import {
  probeWebCodecsWebmMotionEncoder,
  type WebCodecsWebmCapabilityInput,
  type WebCodecsWebmCapabilityResult
} from './webcodecs-webm'

export type MotionWebmCapabilityState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'available'
      readonly encoder: MotionAnimationEncoder
      readonly exportPlan: MotionGraphExportPlan
    }
  | {
      readonly status: 'unavailable'
      readonly reason: string
      readonly exportPlan?: MotionGraphExportPlan
    }

export type MotionWebmCapabilityPreflightInput = Omit<PlanGraphMotionExportOptions, 'signal'>

export function getMotionWebmExportCapabilities(
  state: MotionWebmCapabilityState
): readonly MotionExportCapability[] {
  const encoders = state.status === 'available' ? [state.encoder] : []
  const capabilities = [...getMotionExportCapabilities(encoders)]
  if (state.status !== 'loading' && state.status !== 'unavailable') return capabilities
  const index = capabilities.findIndex(({ format }) => format === 'webm')
  capabilities[index] = {
    format: 'webm',
    available: false,
    mode: 'unavailable',
    reason:
      state.status === 'unavailable'
        ? state.reason
        : 'Checking WebCodecs against the exact Motion export canvas'
  }
  return capabilities
}

interface MotionWebmCapabilityPreflightDependencies {
  readonly debounceMs?: number
  readonly onState: (state: MotionWebmCapabilityState) => void
  readonly plan?: (input: PlanGraphMotionExportOptions) => Promise<MotionGraphExportPlan>
  readonly probe?: (
    input: WebCodecsWebmCapabilityInput,
    signal?: AbortSignal
  ) => Promise<WebCodecsWebmCapabilityResult>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCancellation(error: unknown): boolean {
  return (
    error instanceof MotionExportCancelledError ||
    (error instanceof Error && error.name === 'MotionExportCancelledError')
  )
}

function capabilityKey(input: WebCodecsWebmCapabilityInput): string {
  return `${input.pixelWidth}x${input.pixelHeight}@${input.fps}`
}

/** Debounced, cancel-safe WebCodecs preflight with an exact config cache. */
export function createMotionWebmCapabilityPreflight(
  dependencies: MotionWebmCapabilityPreflightDependencies
) {
  const plan = dependencies.plan ?? planGraphMotionExport
  const probe = dependencies.probe ?? probeWebCodecsWebmMotionEncoder
  const cache = new Map<string, WebCodecsWebmCapabilityResult>()
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  function cancelPending(): void {
    if (timer) clearTimeout(timer)
    timer = null
    controller?.abort()
    controller = null
  }

  function clear(): void {
    generation++
    cancelPending()
    dependencies.onState({ status: 'idle' })
  }

  function schedule(input: MotionWebmCapabilityPreflightInput): void {
    const currentGeneration = ++generation
    cancelPending()
    dependencies.onState({ status: 'loading' })
    timer = setTimeout(() => {
      timer = null
      const currentController = new AbortController()
      controller = currentController
      void (async () => {
        const isStale = (): boolean =>
          currentController.signal.aborted || currentGeneration !== generation
        try {
          const exportPlan = await plan({ ...input, signal: currentController.signal })
          if (isStale()) return
          const config = {
            pixelWidth: exportPlan.plan.pixelWidth,
            pixelHeight: exportPlan.plan.pixelHeight,
            fps: exportPlan.plan.fps
          } as const
          const key = capabilityKey(config)
          let capability = cache.get(key)
          if (!capability) {
            capability = await probe(config, currentController.signal)
            if (isStale()) return
            cache.set(key, capability)
          }
          if (capability.supported) {
            dependencies.onState({
              status: 'available',
              encoder: capability.encoder,
              exportPlan
            })
          } else {
            dependencies.onState({
              status: 'unavailable',
              reason: capability.reason,
              exportPlan
            })
          }
        } catch (error) {
          if (isStale() || isCancellation(error)) {
            return
          }
          dependencies.onState({ status: 'unavailable', reason: errorMessage(error) })
        } finally {
          if (currentGeneration === generation) controller = null
        }
      })()
    }, dependencies.debounceMs ?? 120)
  }

  function dispose(): void {
    generation++
    cancelPending()
  }

  return { schedule, clear, dispose }
}
