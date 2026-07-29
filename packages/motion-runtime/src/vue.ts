import {
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef
} from 'vue'

import type { MotionSpec, MotionTrigger } from '@open-pencil/scene-graph'

import { runMotionCleanup } from './cleanup'
import type { DOMMotionTargetOptions } from './dom'
import { createOwnedMotionRuntime } from './owned-runtime'
import type { MotionRuntime, MotionRuntimeOptions } from './runtime'
import {
  createVanillaMotion,
  type VanillaMotionController,
  type VanillaMotionElement
} from './vanilla'

export interface UseMotionRuntimeResult {
  readonly runtime: MotionRuntime
  dispose(): void
}

export interface UseMotionOptions extends DOMMotionTargetOptions {
  readonly runtime?: MotionRuntime
  readonly runtimeOptions?: MotionRuntimeOptions
  readonly id?: string
  readonly trigger?: MotionTrigger
  readonly autoplay?: boolean
}

export interface UseMotionResult {
  readonly controller: ShallowRef<VanillaMotionController | null>
  play(): void
  stop(): void
  dispose(): void
}

/** Creates a scope-owned runtime. Safe to call during SSR because no DOM is touched. */
export function useMotionRuntime(options?: MotionRuntimeOptions): UseMotionRuntimeResult {
  const ownedRuntime = createOwnedMotionRuntime(options)
  const runtime = ownedRuntime.runtime
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    runMotionCleanup(
      [() => ownedRuntime.disposePreferenceListener(), () => runtime.dispose()],
      'Vue Motion runtime cleanup failed'
    )
  }
  onScopeDispose(dispose, true)
  return { runtime, dispose }
}

/** Reactive Vue adapter. Mounts only when both an element and a MotionSpec are present. */
export function useMotion(
  element: MaybeRefOrGetter<VanillaMotionElement | null | undefined>,
  motion: MaybeRefOrGetter<MotionSpec | null | undefined>,
  options: UseMotionOptions = {}
): UseMotionResult {
  const ownsRuntime = options.runtime === undefined
  const ownedRuntime = ownsRuntime ? createOwnedMotionRuntime(options.runtimeOptions) : undefined
  const runtime = options.runtime ?? ownedRuntime?.runtime
  if (!runtime) throw new Error('Vue Motion runtime ownership could not be resolved')
  const controller = shallowRef<VanillaMotionController | null>(null)
  let disposed = false

  const stopWatching = watch(
    [() => toValue(element), () => toValue(motion)],
    ([nextElement, nextMotion], _previous, onCleanup) => {
      if (!nextElement || !nextMotion || disposed) return
      const next = createVanillaMotion({
        element: nextElement,
        motion: nextMotion,
        runtime,
        ...(options.id ? { id: options.id } : {}),
        ...(options.trigger ? { trigger: options.trigger } : {}),
        ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
        ...(options.authoredOpacity !== undefined
          ? { authoredOpacity: options.authoredOpacity }
          : {}),
        ...(options.authoredTransform !== undefined
          ? { authoredTransform: options.authoredTransform }
          : {}),
        ...(options.textContent ? { textContent: options.textContent } : {}),
        ...(options.advancedCapabilities
          ? { advancedCapabilities: options.advancedCapabilities }
          : {}),
        ...(options.applyAdvanced ? { applyAdvanced: options.applyAdvanced } : {}),
        ...(options.clearAdvanced ? { clearAdvanced: options.clearAdvanced } : {})
      })
      controller.value = next
      onCleanup(() => {
        try {
          next.dispose()
        } finally {
          if (controller.value === next) controller.value = null
        }
      })
    },
    { immediate: true }
  )

  const dispose = () => {
    if (disposed) return
    disposed = true
    runMotionCleanup(
      [
        () => stopWatching(),
        () => {
          const current = controller.value
          controller.value = null
          current?.dispose()
        },
        () => ownedRuntime?.disposePreferenceListener(),
        () => {
          if (ownsRuntime) runtime.dispose()
        }
      ],
      'Vue Motion cleanup failed'
    )
  }
  onScopeDispose(dispose, true)

  return {
    controller,
    play: () => controller.value?.play(),
    stop: () => controller.value?.stop(),
    dispose
  }
}
