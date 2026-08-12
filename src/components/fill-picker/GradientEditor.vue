<script setup lang="ts">
import { tv } from 'tailwind-variants'

import AppSelect from '@/components/ui/AppSelect.vue'
import BindingTrigger from '@/components/ui/binding/BindingTrigger.vue'
import Tip from '@/components/ui/Tip.vue'
import ColorPickerPanel from '@/components/color-picker-panel/ColorPickerPanel.vue'
import NumberField from '@/components/inputs/NumberField.vue'
import VariableBindingPicker from '@/components/variable-binding/VariableBindingPicker.vue'
import fillPickerTheme from '@/theme/fill-picker'
import { colorToCSS, colorToHexRaw } from '@open-pencil/core/color'
import {
  BindableValueRoot,
  GradientEditorRoot,
  GradientEditorBar,
  GradientEditorStop,
  inputValue,
  useColorBindingProvider,
  useI18n,
  vTestId
} from '@open-pencil/vue'

import type { Fill, GradientStop } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'
import type { BindableValueActions, BindingTarget } from '@open-pencil/vue'

const {
  fill,
  selectedNodeIds = [],
  fillIndex = null
} = defineProps<{
  fill: Fill
  selectedNodeIds?: string[]
  fillIndex?: number | null
}>()
const emit = defineEmits<{ update: [fill: Fill] }>()
const { panels, dialogs } = useI18n()
const fillPicker = tv(fillPickerTheme)
const colorProvider = useColorBindingProvider()

function stopTargets(stopIndex: number): BindingTarget[] {
  if (fillIndex == null) return []
  return selectedNodeIds.map((nodeId) => ({
    nodeId,
    path: `fills/${fillIndex}/gradientStops/${stopIndex}/color`
  }))
}

function displayStop(stop: GradientStop, stopIndex: number): GradientStop {
  const targets = stopTargets(stopIndex)
  if (colorProvider.getState(targets) !== 'bound') return stop
  const variable = targets[0] ? colorProvider.getBound(targets[0]) : undefined
  const color = variable ? colorProvider.resolve(variable.id) : undefined
  return color ? { ...stop, color } : stop
}

function mutateStop(actions: BindableValueActions<Color>, mutation: () => void) {
  if (!actions.beginMutation('edit')) return
  try {
    mutation()
    actions.commitMutation()
  } catch (error) {
    actions.cancelMutation()
    throw error
  }
}

function barStopClass(active: boolean, dragging: boolean) {
  return fillPicker({ active, dragging }).barStop()
}

function listStopClass(active: boolean) {
  return fillPicker({ active }).listStop()
}
</script>

<template>
  <GradientEditorRoot :fill="fill" @update="emit('update', $event)" v-slot="root">
    <div>
      <div class="mb-2 w-28">
        <AppSelect
          :model-value="root.subtype"
          :options="root.subtypes"
          @update:model-value="root.actions.setSubtype($event)"
        />
      </div>

      <GradientEditorBar
        :stops="root.stops"
        :active-stop-index="root.activeStopIndex"
        :bar-background="root.barBackground"
        :ui="{ bar: 'relative mb-2 h-6 rounded' }"
        data-test-id="fill-picker-gradient-bar"
        @select-stop="root.actions.selectStop"
        @drag-stop="root.actions.dragStop"
        v-slot="bar"
      >
        <GradientEditorStop
          v-for="(stop, idx) in bar.stops"
          :key="idx"
          :stop="stop"
          :index="idx"
          :active="idx === bar.activeStopIndex"
          :dragging="idx === bar.draggingIndex"
          :removable="bar.stops.length > 2"
          :class="barStopClass(idx === bar.activeStopIndex, idx === bar.draggingIndex)"
          :style="{ left: `${stop.position * 100}%`, background: colorToCSS(stop.color) }"
          @select="root.actions.selectStop"
          @update-position="root.actions.updateStopPosition"
          @remove="root.actions.removeStop"
          @pointerdown.stop="bar.actions.stopPointerDown(idx, $event)"
        />
      </GradientEditorBar>

      <div class="mb-2">
        <div class="mb-1 flex items-center justify-between">
          <span class="text-[11px] text-muted">{{ panels.stops }}</span>
          <Tip :label="panels.addStop">
            <button
              class="flex size-4 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted hover:text-surface"
              data-test-id="fill-picker-add-stop"
              @click="root.actions.addStop"
            >
              <icon-lucide-plus class="size-3" />
            </button>
          </Tip>
        </div>
        <BindableValueRoot
          v-for="(stop, idx) in root.stops"
          :key="idx"
          v-slot="binding"
          :provider="colorProvider"
          :targets="stopTargets(idx)"
          :value="stop.color"
          batch-label="Change gradient stop color"
        >
          <GradientEditorStop
            :stop="displayStop(stop, idx)"
            :index="idx"
            :active="idx === root.activeStopIndex"
            :removable="root.stops.length > 2"
            :interactive="false"
            :class="listStopClass(idx === root.activeStopIndex)"
            @select="root.actions.selectStop"
            @update-position="root.actions.updateStopPosition"
            @update-color="root.actions.updateStopColor"
            @update-opacity="root.actions.updateStopOpacity"
            @remove="root.actions.removeStop"
            v-slot="s"
          >
            <NumberField
              class="w-11"
              suffix="%"
              :model-value="s.positionPercent"
              :min="0"
              :max="100"
              @update:model-value="s.actions.updatePosition(Number($event))"
              @click.stop
            />
            <button
              class="size-4 shrink-0 cursor-pointer rounded border border-border p-0"
              :style="{ background: s.css }"
              @click.stop="s.actions.select"
            />
            <input
              class="min-w-0 flex-1 rounded border border-border bg-input px-1 py-0.5 font-mono text-[11px] text-surface"
              :value="s.hex"
              maxlength="6"
              @change="
                mutateStop(binding.actions, () =>
                  s.actions.updateColor(inputValue($event as Event))
                )
              "
              @click.stop
            />
            <NumberField
              class="w-9"
              suffix="%"
              :model-value="s.opacityPercent"
              :min="0"
              :max="100"
              @update:model-value="
                mutateStop(binding.actions, () => s.actions.updateOpacity(Number($event)))
              "
              @click.stop
            />
            <VariableBindingPicker
              v-if="binding.state !== 'bound'"
              :trigger-label="panels.applyVariable"
              :search-placeholder="dialogs.search"
              :empty-label="panels.noVariablesFound"
              :detach-label="panels.detachVariable"
              :create-label="
                panels.createColorVariable({ value: `#${colorToHexRaw(s.stop.color)}` })
              "
              :create-name-placeholder="panels.variableName"
              :create-submit-label="panels.create"
            >
              <template #trigger="{ state, open }">
                <BindingTrigger
                  :label="panels.applyVariable"
                  :state="state"
                  :open="open"
                  v-test-id="`fill-gradient-stop-apply-variable-${s.index}`"
                />
              </template>
            </VariableBindingPicker>
            <Tip v-else :label="panels.detachVariable">
              <BindingTrigger
                :label="panels.detachVariable"
                state="bound"
                v-test-id="`fill-gradient-stop-unbind-variable-${s.index}`"
                @click.stop="binding.actions.unbind"
              />
            </Tip>
            <button
              v-if="root.stops.length > 2"
              class="flex size-4 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted hover:text-surface"
              :aria-label="dialogs.removeGradientStop"
              @click.stop="s.actions.remove"
            >
              <icon-lucide-minus class="size-3" />
            </button>
          </GradientEditorStop>
        </BindableValueRoot>
      </div>

      <BindableValueRoot
        v-slot="binding"
        :provider="colorProvider"
        :targets="stopTargets(root.activeStopIndex)"
        :value="root.activeColor"
        batch-label="Change gradient stop color"
      >
        <ColorPickerPanel
          :color="binding.resolvedValue ?? root.activeColor"
          @update="
            mutateStop(binding.actions, () => root.actions.updateActiveColor($event as Color))
          "
        />
      </BindableValueRoot>
    </div>
  </GradientEditorRoot>
</template>
