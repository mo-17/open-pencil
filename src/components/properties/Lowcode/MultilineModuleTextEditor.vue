<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useRetainedActivity } from '@open-pencil/vue'

import { useModuleTextDraft } from '@/app/lowcode/module-editor/multiline'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'

const {
  owner,
  config,
  modelValue,
  label,
  maxLength,
  countLabel,
  rows = 10,
  wrap = 'off',
  monospace = true,
  error = ''
} = defineProps<{
  owner?: SceneNode
  config: JSONObject
  modelValue: string
  label: string
  maxLength: number
  countLabel?: (count: number, maximum: number) => string
  rows?: number
  wrap?: 'soft' | 'off'
  monospace?: boolean
  error?: string
}>()

const emit = defineEmits<{
  commit: [request: ModuleScalarCommit]
}>()

const { draft, generation, beginInput, update, submit } = useModuleTextDraft(
  () => owner,
  () => config,
  () => modelValue,
  () => maxLength,
  useRetainedActivity(),
  (request) => emit('commit', request)
)
const overLimit = computed(() => draft.value.length > maxLength)
const countText = computed(() =>
  countLabel ? countLabel(draft.value.length, maxLength) : `${draft.value.length}/${maxLength}`
)

function renderedGeneration(event: Event): number {
  return Number((event.currentTarget as HTMLElement).dataset.generation)
}

function updateDraft(event: Event): void {
  update((event.target as HTMLTextAreaElement).value, renderedGeneration(event))
}
</script>

<template>
  <div data-test-id="multiline-module-text-editor" class="flex flex-col gap-1.5">
    <textarea
      :key="generation"
      :data-generation="generation"
      :value="draft"
      :aria-label="label"
      :maxlength="maxLength"
      :rows="rows"
      :wrap="wrap"
      data-test-id="multiline-module-text-source"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :class="[
        'w-full resize-y rounded border border-border bg-input px-2 py-1.5 text-[10px] leading-relaxed text-surface outline-none focus:border-accent',
        monospace ? 'font-mono' : ''
      ]"
      @input="updateDraft"
      @focus="beginInput(renderedGeneration($event))"
      @pointerdown="beginInput(renderedGeneration($event))"
      @keydown="beginInput(renderedGeneration($event))"
      @change="submit(renderedGeneration($event))"
      @blur="submit(renderedGeneration($event))"
    />

    <div class="flex items-center justify-end gap-2 text-[9px] text-muted">
      <span data-test-id="multiline-module-text-length" aria-live="polite">
        {{ countText }}
      </span>
    </div>

    <p
      v-if="overLimit || error"
      data-test-id="multiline-module-text-error"
      class="text-[10px] text-error"
    >
      {{ error }}
    </p>
  </div>
</template>
