import { useLocalStorage } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import {
  canvasPerformanceProfile,
  DEFAULT_CANVAS_PERFORMANCE_MODE,
  normalizeCanvasPerformanceMode,
  type CanvasPerformanceMode
} from '@open-pencil/core/canvas'
import {
  figParseWorkerConcurrencyForDeviceMemory,
  setFigParseWorkerConcurrency
} from '@open-pencil/core/io/formats/fig'
import { setDefaultLayoutTimeSliceMs } from '@open-pencil/core/layout'
import { fontManager } from '@open-pencil/core/text'
import type { CanvasActiveFrameSample } from '@open-pencil/vue'

import { CanvasAutoPerformanceController } from './canvas-auto-performance'

export const CANVAS_PERFORMANCE_STORAGE_KEY = 'open-pencil:canvas-performance-profile'
export const AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE = 'automatic' as const
export type CanvasPerformancePreference =
  | CanvasPerformanceMode
  | typeof AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE

export function normalizeCanvasPerformancePreference(value: unknown): CanvasPerformancePreference {
  return value === AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE
    ? AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE
    : normalizeCanvasPerformanceMode(value)
}

export function repairStoredCanvasPerformanceMode(
  value: unknown,
  persist: (mode: CanvasPerformancePreference) => void
): CanvasPerformancePreference {
  const mode = normalizeCanvasPerformancePreference(value)
  if (value !== mode) persist(mode)
  return mode
}

const storedMode = useLocalStorage<unknown>(
  CANVAS_PERFORMANCE_STORAGE_KEY,
  DEFAULT_CANVAS_PERFORMANCE_MODE
)

watch(
  storedMode,
  (value) => {
    repairStoredCanvasPerformanceMode(value, (mode) => {
      storedMode.value = mode
    })
  },
  { immediate: true }
)

const autoController = new CanvasAutoPerformanceController()
const automaticPerformanceMode = shallowRef<CanvasPerformanceMode>(autoController.mode)
export const canvasAutomaticPerformanceSnapshot = shallowRef(autoController.snapshot)

export const canvasPerformancePreference = computed<CanvasPerformancePreference>({
  get: () => normalizeCanvasPerformancePreference(storedMode.value),
  set: (mode) => {
    storedMode.value = normalizeCanvasPerformancePreference(mode)
  }
})

export const canvasPerformanceMode = computed<CanvasPerformanceMode>(() => {
  const preference = canvasPerformancePreference.value
  return preference === AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE
    ? automaticPerformanceMode.value
    : preference
})

export interface CanvasRuntimePerformanceTargets {
  deviceMemoryGiB?: number
  setFontLoadConcurrency(concurrency: number): void
  setFigParseWorkerConcurrency(concurrency: number): void
  setLayoutTimeSliceMs(timeSliceMs: number): void
}

function runtimeDeviceMemoryGiB(): number | undefined {
  if (typeof navigator === 'undefined') return undefined
  const value = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function applyCanvasRuntimePerformanceMode(
  mode: CanvasPerformanceMode,
  targets: CanvasRuntimePerformanceTargets = {
    deviceMemoryGiB: runtimeDeviceMemoryGiB(),
    setFontLoadConcurrency: (concurrency) => fontManager.setLoadConcurrency(concurrency),
    setFigParseWorkerConcurrency,
    setLayoutTimeSliceMs: setDefaultLayoutTimeSliceMs
  }
): void {
  const profile = canvasPerformanceProfile(mode)
  targets.setFontLoadConcurrency(profile.fontLoadConcurrency)
  targets.setFigParseWorkerConcurrency(
    Math.min(
      profile.figParseWorkerConcurrency,
      figParseWorkerConcurrencyForDeviceMemory(targets.deviceMemoryGiB)
    )
  )
  targets.setLayoutTimeSliceMs(profile.backgroundLayoutTimeSliceMs)
}

watch(canvasPerformanceMode, (mode) => applyCanvasRuntimePerformanceMode(mode), {
  immediate: true,
  flush: 'sync'
})

watch(
  canvasPerformancePreference,
  (preference) => {
    const mode = autoController.reset(
      preference === AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE ? 'balanced' : preference
    )
    automaticPerformanceMode.value = mode
    canvasAutomaticPerformanceSnapshot.value = autoController.snapshot
  },
  { immediate: true }
)

export function recordActiveCanvasFrame(sample: CanvasActiveFrameSample): void {
  if (canvasPerformancePreference.value !== AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE) return
  const previousSnapshot = autoController.snapshot
  automaticPerformanceMode.value = autoController.record(sample)
  if (autoController.snapshot !== previousSnapshot) {
    canvasAutomaticPerformanceSnapshot.value = autoController.snapshot
  }
}
