<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity } from '@open-pencil/vue'

import type { ChartDataCommit } from '@/app/lowcode/chart-editor'
import { chartEditorCopy } from '@/app/lowcode/chart-editor/copy'
import { useChartDataDraft } from '@/app/lowcode/chart-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

const { owner, config } = defineProps<{ owner?: SceneNode; config: JSONObject }>()
const emit = defineEmits<{ commit: [request: ChartDataCommit] }>()
const { locale } = useI18n()
const copy = computed(() => chartEditorCopy(locale.value))
const { rows, dirty, error, generation, beginInput, input, add, remove, cancel, apply } =
  useChartDataDraft(
    () => owner,
    () => config,
    (request) => emit('commit', request),
    useRetainedActivity()
  )

// Read the rendered DOM generation, not the latest reactive value in a late event handler.
function renderedGeneration(event: Event): number {
  const element = event.currentTarget
  if (!(element instanceof Element)) return -1
  return Number(
    element.closest('[data-chart-generation]')?.getAttribute('data-chart-generation') ?? -1
  )
}
</script>

<template>
  <div
    :key="generation"
    :data-chart-generation="generation"
    data-test-id="chart-data-editor"
    role="group"
    :aria-label="copy.heading"
    class="flex flex-col gap-2"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ copy.hint }}</p>
    <span class="text-right text-[9px] text-muted">{{ rows.length }}/64</span>
    <div class="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
      <div
        v-for="(row, index) in rows"
        :key="row.key"
        data-test-id="chart-data-row"
        class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1 rounded border border-border bg-input p-2"
      >
        <label class="min-w-0 text-[10px] text-muted"
          >{{ index + 1 }} · {{ copy.label }}
          <AppInput
            :model-value="row.label"
            :ariaLabel="copy.label"
            :maxlength="80"
            @focus="beginInput(row.key, renderedGeneration($event))"
            @update:model-value="input(row.key, 'label', $event)"
          />
        </label>
        <label class="min-w-0 text-[10px] text-muted"
          >{{ copy.value }}
          <AppInput
            :model-value="row.value"
            :ariaLabel="copy.value"
            inputmode="decimal"
            :maxlength="40"
            @focus="beginInput(row.key, renderedGeneration($event))"
            @update:model-value="input(row.key, 'value', $event)"
          />
        </label>
        <AppButton
          variant="ghost"
          size="xs"
          class="min-h-9"
          :disabled="rows.length <= 1"
          :aria-label="copy.remove"
          @click="remove(row.key, renderedGeneration($event))"
          ><icon-lucide-x class="size-3"
        /></AppButton>
      </div>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 64"
      data-test-id="chart-data-add"
      @click="add(copy.newItem, renderedGeneration($event))"
      >{{ copy.add }}</AppButton
    >
    <AppAlert
      v-if="error"
      tone="warning"
      :heading="copy.errors[error]"
      data-test-id="chart-data-error"
    />
    <p v-if="dirty" class="text-[10px] text-muted" role="status">{{ copy.pending }}</p>
    <div class="flex gap-2">
      <AppButton
        color="primary"
        size="xs"
        :disabled="!dirty"
        data-test-id="chart-data-apply"
        @click="apply(renderedGeneration($event))"
        >{{ copy.apply }}</AppButton
      >
      <AppButton
        variant="ghost"
        size="xs"
        :disabled="!dirty"
        data-test-id="chart-data-cancel"
        @click="cancel(renderedGeneration($event))"
        >{{ copy.cancel }}</AppButton
      >
    </div>
  </div>
</template>
