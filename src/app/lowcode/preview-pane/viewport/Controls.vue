<script setup lang="ts">
import { useCodeMessages } from '@open-pencil/vue'

import type { PreviewTextScale } from '../iframe/messages'
import { boundPreviewDimension, PREVIEW_MIN_DIMENSION, PREVIEW_MAX_DIMENSION } from './dimensions'
import { PREVIEW_TEXT_SCALES, type PreviewViewport } from './use'

const viewport = defineModel<PreviewViewport>({ required: true })
const width = defineModel<number>('width', { required: true })
const height = defineModel<number>('height', { required: true })
const textScale = defineModel<PreviewTextScale>('textScale', { required: true })
const keyboard = defineModel<boolean>('keyboard', { required: true })
const diagnostics = defineModel<boolean>('diagnostics', { required: true })
const { simulationAvailable = true } = defineProps<{ simulationAvailable?: boolean }>()
const messages = useCodeMessages()

function commitDimension(event: Event, dimension: 'width' | 'height') {
  if (!(event.target instanceof HTMLInputElement)) return
  const model = dimension === 'width' ? width : height
  const next = boundPreviewDimension(event.target.valueAsNumber)
  if (next !== null) model.value = next
  event.target.value = String(next ?? model.value)
}
</script>

<template>
  <div
    class="shrink-0 space-y-2 border-b border-border bg-panel px-3 py-2 text-xs text-muted"
    data-test-id="lowcode-preview-viewport-controls"
  >
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-2">
        <span>{{ messages.previewViewportSize }}</span>
        <select
          v-model="viewport"
          data-test-id="lowcode-preview-viewport"
          class="h-7 rounded border border-border bg-input px-2 text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <option value="fit">{{ messages.previewViewportFit }}</option>
          <option value="phone">{{ messages.previewViewportPhone }}</option>
          <option value="landscape">{{ messages.previewViewportLandscape }}</option>
          <option value="tablet">{{ messages.previewViewportTablet }}</option>
          <option value="desktop">{{ messages.previewViewportDesktop }}</option>
          <option value="custom">{{ messages.previewViewportCustom }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1">
        <span>{{ messages.previewViewportWidth }}</span>
        <input
          :value="width"
          type="number"
          inputmode="numeric"
          :min="PREVIEW_MIN_DIMENSION"
          :max="PREVIEW_MAX_DIMENSION"
          step="1"
          data-test-id="lowcode-preview-width"
          class="h-7 w-20 rounded border border-border bg-input px-2 text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
          @change="commitDimension($event, 'width')"
          @keydown.enter="commitDimension($event, 'width')"
        />
        <span>px</span>
      </label>
      <label class="flex items-center gap-1">
        <span>{{ messages.previewViewportHeight }}</span>
        <input
          :value="height"
          type="number"
          inputmode="numeric"
          :min="PREVIEW_MIN_DIMENSION"
          :max="PREVIEW_MAX_DIMENSION"
          step="1"
          data-test-id="lowcode-preview-height"
          class="h-7 w-20 rounded border border-border bg-input px-2 text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
          @change="commitDimension($event, 'height')"
          @keydown.enter="commitDimension($event, 'height')"
        />
        <span>px</span>
      </label>
    </div>
    <label class="flex items-center gap-2">
      <span>{{ messages.previewViewportWidthSlider }}</span>
      <input
        :value="width"
        type="range"
        :min="PREVIEW_MIN_DIMENSION"
        :max="PREVIEW_MAX_DIMENSION"
        step="1"
        data-test-id="lowcode-preview-width-slider"
        class="min-w-0 flex-1 accent-accent"
        @input="commitDimension($event, 'width')"
      />
    </label>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label class="flex items-center gap-2">
        <span>{{ messages.previewTextScale }}</span>
        <select
          v-model="textScale"
          :disabled="!simulationAvailable"
          data-test-id="lowcode-preview-text-scale"
          class="h-7 rounded border border-border bg-input px-2 text-surface outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50"
        >
          <option v-for="scale in PREVIEW_TEXT_SCALES" :key="scale" :value="scale">
            {{ scale === 1 ? messages.previewTextScaleDefault : `${scale}×` }}
          </option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="keyboard" type="checkbox" data-test-id="lowcode-preview-keyboard" />
        <span>{{ messages.previewKeyboard }}</span>
      </label>
      <label
        :data-simulation-available="simulationAvailable"
        class="flex items-center gap-2 data-[simulation-available=false]:opacity-50"
      >
        <input
          v-model="diagnostics"
          type="checkbox"
          :disabled="!simulationAvailable"
          data-test-id="lowcode-preview-diagnostics"
        />
        <span>{{ messages.previewAdaptationDiagnostics }}</span>
      </label>
    </div>
    <p class="text-[11px] leading-relaxed">{{ messages.previewSimulationHint }}</p>
    <p v-if="!simulationAvailable" class="text-[11px] leading-relaxed">
      {{ messages.previewSimulationUnavailable }}
    </p>
  </div>
</template>
