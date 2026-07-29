<script setup lang="ts">
import { computed } from 'vue'

import { MOTION_DRIVER_LIMITS, type MotionDriverSource } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import NumberField from '@/components/inputs/NumberField.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

import { MOTION_DRIVER_SOURCE_KINDS, useMotionDrivers } from './use-motion-drivers'

const OWNER_SOURCE = '__owner__'
const { panels } = useI18n()
const {
  owner,
  drivers,
  selectedDriverId,
  selectedDriver,
  nodes,
  tracks,
  pageStates,
  documentStates,
  variables,
  canAdd,
  localError,
  previewProgress,
  previewingDriverId,
  addDriver,
  deleteSelected,
  setSourceKind,
  setOptionalSourceNodeId,
  setRequiredSourceNodeId,
  setAxis,
  setScrollMetric,
  setPointerSpace,
  setDragDistance,
  setStateId,
  setVariableId,
  setTargetTrack,
  setMapping,
  preview,
  stopPreview
} = useMotionDrivers()

const sourceOptions = computed(() => {
  const sourceLabels: Record<MotionDriverSource['kind'], string> = {
    scroll: panels.value.motionDriversScroll,
    pointer: panels.value.motionDriversPointer,
    drag: panels.value.motionDriversDrag,
    visibility: panels.value.motionDriversVisibility,
    pageState: panels.value.motionDriversPageState,
    documentState: panels.value.motionDriversDocumentState,
    variable: panels.value.motionDriversVariable
  }
  return MOTION_DRIVER_SOURCE_KINDS.map((kind) => ({ value: kind, label: sourceLabels[kind] }))
})
const axisOptions = computed<Array<{ value: 'x' | 'y'; label: string }>>(() => [
  { value: 'x', label: panels.value.xAxis },
  { value: 'y', label: panels.value.yAxis }
])
const scrollMetricOptions = computed<Array<{ value: 'progress' | 'offset'; label: string }>>(() => [
  { value: 'progress', label: panels.value.motionDriversProgress },
  { value: 'offset', label: panels.value.motionDriversOffset }
])
const pointerSpaceOptions = computed<Array<{ value: 'local' | 'viewport'; label: string }>>(() => [
  { value: 'local', label: panels.value.motionDriversLocal },
  { value: 'viewport', label: panels.value.motionDriversViewport }
])
const driverOptions = computed(() =>
  drivers.value.map((driver) => ({ value: driver.id, label: driver.id }))
)
const sourceNodeOptions = computed(() => [
  { value: OWNER_SOURCE, label: panels.value.motionDriversOwnerViewport },
  ...nodes.value.map((node) => ({ value: node.id, label: `${node.name} · ${node.id}` }))
])
const requiredNodeOptions = computed(() =>
  nodes.value.map((node) => ({ value: node.id, label: `${node.name} · ${node.id}` }))
)
const trackOptions = computed(() =>
  tracks.value.map((track) => ({
    value: track.key,
    label: `${track.nodeName} · ${track.trackName}`
  }))
)
const variableOptions = computed(() =>
  variables.value.map((variable) => ({
    value: variable.id,
    label: `${variable.name} · ${variable.id}`
  }))
)
const stateOptions = computed(() => {
  const states = sourceKind.value === 'pageState' ? pageStates.value : documentStates.value
  return states.map((state) => ({
    value: state.id,
    label: `${state.name} · ${state.id}`
  }))
})
const sourceKind = computed({
  get: () => selectedDriver.value?.source.kind ?? 'scroll',
  set: setSourceKind
})
const optionalSourceNodeId = computed({
  get: () => {
    const source = selectedDriver.value?.source
    return source && (source.kind === 'scroll' || source.kind === 'pointer')
      ? (source.sourceNodeId ?? OWNER_SOURCE)
      : OWNER_SOURCE
  },
  set: (value: string) => setOptionalSourceNodeId(value === OWNER_SOURCE ? '' : value)
})
const requiredSourceNodeId = computed({
  get: () => {
    const source = selectedDriver.value?.source
    if (source?.kind === 'drag') return source.handleNodeId
    if (source?.kind === 'visibility') return source.sourceNodeId
    return owner.value?.id ?? ''
  },
  set: setRequiredSourceNodeId
})
const axis = computed({
  get: () => {
    const source = selectedDriver.value?.source
    return source && 'axis' in source ? source.axis : 'x'
  },
  set: setAxis
})
const scrollMetric = computed({
  get: () =>
    selectedDriver.value?.source.kind === 'scroll'
      ? selectedDriver.value.source.metric
      : 'progress',
  set: setScrollMetric
})
const pointerSpace = computed({
  get: () =>
    selectedDriver.value?.source.kind === 'pointer' ? selectedDriver.value.source.space : 'local',
  set: setPointerSpace
})
const stateId = computed({
  get: () => {
    const source = selectedDriver.value?.source
    return source?.kind === 'pageState' || source?.kind === 'documentState' ? source.stateId : ''
  },
  set: (value: string | number) => setStateId(String(value))
})
const variableId = computed({
  get: () =>
    selectedDriver.value?.source.kind === 'variable' ? selectedDriver.value.source.variableId : '',
  set: setVariableId
})
const targetTrackKey = computed({
  get: () => {
    const target = selectedDriver.value?.target
    return target ? JSON.stringify([target.targetNodeId, target.trackId]) : ''
  },
  set: setTargetTrack
})

function previewFromEvent(event: Event): void {
  preview(Number((event.target as HTMLInputElement).value))
}

function checkboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <PanelSection :label="panels.motionDrivers">
    <div data-test-id="motion-drivers-panel" class="space-y-2 border-t border-border pt-3">
      <p v-if="!owner" class="text-[10px] leading-4 text-muted">
        {{ panels.motionDriversSelectOwner }}
      </p>
      <template v-else>
        <div class="flex items-center justify-between gap-2">
          <p class="min-w-0 truncate text-[10px] text-muted">
            {{ owner.name }} · {{ owner.type === 'CANVAS' ? panels.page : panels.frame }}
          </p>
          <button
            type="button"
            class="rounded px-1.5 py-1 text-[10px] text-accent hover:bg-hover disabled:opacity-40"
            :disabled="!canAdd"
            data-test-id="motion-driver-add"
            @click="addDriver"
          >
            + {{ panels.add }}
          </button>
        </div>

        <p v-if="tracks.length === 0" class="rounded bg-hover px-2 py-1.5 text-[10px] text-muted">
          {{ panels.motionDriversNoTracks }}
        </p>

        <template v-if="selectedDriver">
          <div class="grid grid-cols-[1fr_auto] gap-1.5">
            <AppSelect
              v-model="selectedDriverId"
              :options="driverOptions"
              :label="panels.motionDriversDriver"
              data-test-id="motion-driver-select"
            />
            <button
              type="button"
              class="rounded border border-border px-2 text-[10px] text-danger hover:bg-hover"
              data-test-id="motion-driver-delete"
              @click="deleteSelected"
            >
              {{ panels.motionDriversDelete }}
            </button>
          </div>

          <label class="block space-y-1 text-[10px] text-muted">
            <span>{{ panels.motionDriversInputSource }}</span>
            <AppSelect
              v-model="sourceKind"
              :options="sourceOptions"
              :label="panels.motionDriversInputSource"
              data-test-id="motion-driver-source-kind"
            />
          </label>

          <AppSelect
            v-if="sourceKind === 'scroll' || sourceKind === 'pointer'"
            v-model="optionalSourceNodeId"
            :options="sourceNodeOptions"
            :label="panels.motionDriversSourceNode"
            data-test-id="motion-driver-source-node"
          />
          <AppSelect
            v-if="sourceKind === 'drag' || sourceKind === 'visibility'"
            v-model="requiredSourceNodeId"
            :options="requiredNodeOptions"
            :label="panels.motionDriversSourceNode"
            data-test-id="motion-driver-required-source-node"
          />
          <div
            v-if="sourceKind === 'scroll' || sourceKind === 'pointer' || sourceKind === 'drag'"
            class="grid grid-cols-2 gap-1.5"
          >
            <AppSelect v-model="axis" :options="axisOptions" :label="panels.motionDriversAxis" />
            <AppSelect
              v-if="sourceKind === 'scroll'"
              v-model="scrollMetric"
              :options="scrollMetricOptions"
              :label="panels.motionDriversScrollMetric"
            />
            <AppSelect
              v-if="sourceKind === 'pointer'"
              v-model="pointerSpace"
              :options="pointerSpaceOptions"
              :label="panels.motionDriversPointerSpace"
            />
            <NumberField
              v-if="sourceKind === 'drag' && selectedDriver.source.kind === 'drag'"
              :model-value="selectedDriver.source.distance"
              :label="panels.motionDistance"
              :min="MOTION_DRIVER_LIMITS.dragDistance.min"
              :max="MOTION_DRIVER_LIMITS.dragDistance.max"
              :step="1"
              suffix="px"
              @commit="setDragDistance($event)"
            />
          </div>

          <div
            v-if="sourceKind === 'pageState' || sourceKind === 'documentState'"
            class="space-y-1"
          >
            <AppSelect
              v-if="stateOptions.length > 0"
              v-model="stateId"
              :options="stateOptions"
              :label="panels.motionDriversStateId"
              data-test-id="motion-driver-state-id"
            />
            <p v-else class="rounded bg-hover px-2 py-1.5 text-[10px] text-muted">
              {{ panels.motionDriversStateMissing }}
            </p>
          </div>
          <div v-if="sourceKind === 'variable'" class="space-y-1">
            <AppSelect
              v-if="variableOptions.length > 0"
              v-model="variableId"
              :options="variableOptions"
              :label="panels.motionDriversVariable"
              data-test-id="motion-driver-variable-id"
            />
            <p v-else class="rounded bg-hover px-2 py-1.5 text-[10px] text-muted">
              {{ panels.motionDriversVariableMissing }}
            </p>
          </div>

          <label class="block space-y-1 text-[10px] text-muted">
            <span>{{ panels.motionDriversTargetTrack }}</span>
            <AppSelect
              v-model="targetTrackKey"
              :options="trackOptions"
              :label="panels.motionDriversTargetTrack"
              data-test-id="motion-driver-target-track"
            />
          </label>

          <div class="grid grid-cols-2 gap-1.5">
            <NumberField
              :model-value="selectedDriver.mapping.inputMin"
              :label="panels.motionDriversInputMin"
              :min="MOTION_DRIVER_LIMITS.input.min"
              :max="MOTION_DRIVER_LIMITS.input.max"
              :step="0.1"
              @commit="setMapping('inputMin', $event, true)"
            />
            <NumberField
              :model-value="selectedDriver.mapping.inputMax"
              :label="panels.motionDriversInputMax"
              :min="MOTION_DRIVER_LIMITS.input.min"
              :max="MOTION_DRIVER_LIMITS.input.max"
              :step="0.1"
              @commit="setMapping('inputMax', $event, true)"
            />
            <NumberField
              :model-value="selectedDriver.mapping.deadZone ?? 0"
              :label="panels.motionDriversDeadZone"
              :min="MOTION_DRIVER_LIMITS.deadZone.min"
              :max="MOTION_DRIVER_LIMITS.deadZone.max"
              :step="0.01"
              @commit="setMapping('deadZone', $event, true)"
            />
            <div class="flex items-center gap-3 px-1 text-[10px] text-muted">
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  class="size-3 accent-accent"
                  :checked="selectedDriver.mapping.clamp ?? true"
                  @change="setMapping('clamp', checkboxValue($event))"
                />
                {{ panels.motionDriversClamp }}
              </label>
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  class="size-3 accent-accent"
                  :checked="selectedDriver.mapping.reverse ?? false"
                  @change="setMapping('reverse', checkboxValue($event))"
                />
                {{ panels.motionDriversReverse }}
              </label>
            </div>
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between text-[10px] text-muted">
              <span>{{ panels.motionDriversPreviewProgress }}</span>
              <span class="tabular-nums">{{ Math.round(previewProgress * 100) }}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="previewProgress"
              class="w-full accent-accent"
              data-test-id="motion-driver-preview"
              @input="previewFromEvent"
              @keydown.stop
            />
            <button
              v-if="previewingDriverId"
              type="button"
              class="w-full rounded border border-border py-1 text-[10px] text-muted hover:bg-hover"
              data-test-id="motion-driver-preview-stop"
              @click="stopPreview"
            >
              {{ panels.motionStopPreview }}
            </button>
          </div>
        </template>

        <p
          v-if="localError"
          class="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[10px] leading-4 text-danger"
          data-test-id="motion-driver-error"
        >
          {{ localError }}
        </p>
      </template>
    </div>
  </PanelSection>
</template>
