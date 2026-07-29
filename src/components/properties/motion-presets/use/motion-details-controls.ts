import { computed, onBeforeUnmount, watch } from 'vue'

import {
  isMotionPresetId,
  MOTION_PRESET_REGISTRY,
  type MotionTrigger
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  clearSelectedMotion,
  MOTION_MIXED,
  setMotionPresetParameter,
  setMotionReducedMotion,
  setMotionTiming,
  setMotionTrigger,
  type MotionReducedMotionChoice,
  type MotionSelectionState,
  type MotionSharedValue
} from '@/app/properties/motion'
import { motionNodeAuthoringCapabilityReason } from '@/app/properties/motion/v2-capabilities'

export interface MotionDetailsControlsProps {
  selection: MotionSelectionState
  selectedIds: string[]
}

interface MotionDetailsControlsOptions {
  selection: () => MotionSelectionState
  selectedIds: () => string[]
}

type TriggerSelectValue = MotionTrigger | 'MIXED'
type ReducedMotionSelectValue = MotionReducedMotionChoice | 'MIXED'

export function useMotionDetailsControls(options: MotionDetailsControlsOptions) {
  const store = useEditorStore()
  const { panels } = useI18n()
  const previewVisible = computed(() => store.hasMotionPreview())
  const selectedKey = computed(() => options.selectedIds().join('\0'))
  const singleMotionNode = useSceneComputed(() => {
    const selectedIds = options.selectedIds()
    if (selectedIds.length !== 1) return undefined
    const node = store.graph.getNode(selectedIds[0] ?? '')
    return node?.motion ? node : undefined
  })
  const authoringCapabilityReason = useSceneComputed(() => {
    for (const id of options.selectedIds()) {
      const reason = motionNodeAuthoringCapabilityReason(store.graph.getNode(id))
      if (reason) return reason
    }
    return null
  })
  const authoringDisabled = computed(() => authoringCapabilityReason.value !== null)
  const commonPresetDefinition = computed(() => {
    const presetId = options.selection().presetId
    return isMotionPresetId(presetId) ? MOTION_PRESET_REGISTRY[presetId] : undefined
  })
  const distanceRule = computed(() => commonPresetDefinition.value?.parameters.distance)
  const intensityRule = computed(() => commonPresetDefinition.value?.parameters.intensity)

  const statusText = computed(() => {
    const selection = options.selection()
    if (!selection.hasMotion) return panels.value.motionNoneHint
    if (selection.mixed || selection.presetId === MOTION_MIXED) {
      return panels.value.motionMixed
    }
    return selection.presetId === 'custom' ? panels.value.motionCustom : ''
  })

  const triggerOptions = computed<Array<{ value: TriggerSelectValue; label: string }>>(() => {
    const choices: Array<{ value: MotionTrigger; label: string }> = [
      { value: 'mount', label: panels.value.motionTriggerMount },
      { value: 'pageEnter', label: panels.value.motionTriggerPageEnter },
      { value: 'pageExit', label: panels.value.motionTriggerPageExit },
      { value: 'hover', label: panels.value.motionTriggerHover },
      { value: 'press', label: panels.value.motionTriggerPress },
      { value: 'focus', label: panels.value.motionTriggerFocus },
      { value: 'click', label: panels.value.motionTriggerClick },
      { value: 'inView', label: panels.value.motionTriggerInView },
      { value: 'loop', label: panels.value.motionTriggerLoop }
    ]
    const trigger = options.selection().trigger
    return trigger === MOTION_MIXED || trigger === undefined
      ? [{ value: 'MIXED', label: panels.value.mixed }, ...choices]
      : choices
  })
  const triggerValue = computed<TriggerSelectValue>(() => {
    const value = options.selection().trigger
    return value === MOTION_MIXED || value === undefined ? 'MIXED' : value
  })

  const reducedMotionOptions = computed<Array<{ value: ReducedMotionSelectValue; label: string }>>(
    () => {
      const choices: Array<{ value: MotionReducedMotionChoice; label: string }> = [
        { value: 'default', label: panels.value.motionReducedDefault },
        { value: 'reduce', label: panels.value.motionReducedReduce },
        { value: 'disable', label: panels.value.motionReducedDisable },
        { value: 'allow', label: panels.value.motionReducedAllow }
      ]
      const reducedMotion = options.selection().reducedMotion
      return reducedMotion === MOTION_MIXED || reducedMotion === undefined
        ? [{ value: 'MIXED', label: panels.value.mixed }, ...choices]
        : choices
    }
  )
  const reducedMotionValue = computed<ReducedMotionSelectValue>(() => {
    const value = options.selection().reducedMotion
    return value === MOTION_MIXED || value === undefined ? 'MIXED' : value
  })

  const previewAvailable = computed(
    () => typeof store.previewMotion === 'function' && typeof store.stopMotionPreview === 'function'
  )
  const previewTrigger = computed(() => {
    const trigger = options.selection().trigger
    return trigger === MOTION_MIXED ? undefined : trigger
  })
  const canPreview = computed(
    () =>
      previewAvailable.value &&
      !authoringDisabled.value &&
      options.selection().allHaveMotion &&
      previewTrigger.value !== undefined
  )

  function numberValue(value: MotionSharedValue<number>): number | symbol {
    return typeof value === 'number' ? value : MOTION_MIXED
  }

  function stopPreview() {
    store.stopMotionPreview()
  }

  function previewSelection() {
    if (!canPreview.value || previewTrigger.value === undefined) return
    store.previewMotion(options.selectedIds(), previewTrigger.value)
  }

  function clearMotion() {
    stopPreview()
    clearSelectedMotion(store, options.selectedIds(), panels.value.motionClear)
  }

  function updateTrigger(value: TriggerSelectValue) {
    if (value === 'MIXED' || authoringDisabled.value) return
    stopPreview()
    setMotionTrigger(store, options.selectedIds(), value, panels.value.motionUpdate)
  }

  function updateReducedMotion(value: ReducedMotionSelectValue) {
    if (value === 'MIXED' || authoringDisabled.value) return
    stopPreview()
    setMotionReducedMotion(store, options.selectedIds(), value, panels.value.motionUpdate)
  }

  function updateTiming(field: 'durationMs' | 'delayMs', value: number) {
    if (authoringDisabled.value) return
    stopPreview()
    setMotionTiming(store, options.selectedIds(), field, value, panels.value.motionUpdate)
  }

  function updateParameter(name: 'distance' | 'intensity', value: number) {
    if (authoringDisabled.value) return
    stopPreview()
    setMotionPresetParameter(store, options.selectedIds(), name, value, panels.value.motionUpdate)
  }

  watch(selectedKey, stopPreview)
  watch(authoringDisabled, (disabled) => {
    if (disabled) stopPreview()
  })
  onBeforeUnmount(stopPreview)

  return {
    panels,
    previewVisible,
    singleMotionNode,
    authoringDisabled,
    distanceRule,
    intensityRule,
    statusText,
    triggerOptions,
    triggerValue,
    reducedMotionOptions,
    reducedMotionValue,
    previewAvailable,
    canPreview,
    numberValue,
    previewSelection,
    stopPreview,
    clearMotion,
    updateTrigger,
    updateReducedMotion,
    updateTiming,
    updateParameter
  }
}
