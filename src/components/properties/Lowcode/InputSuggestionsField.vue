<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'

import { parseInputSuggestions } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

const { owner, properties } = defineProps<{
  owner?: SceneNode
  properties: Record<string, unknown>
}>()
const emit = defineEmits<{
  commit: [values: string[], owner: SceneNode | undefined, previous: Record<string, unknown>]
}>()
const panels = usePanelMessages()
const active = useRetainedActivity()
const draft = ref<string[]>([])
let previous: Record<string, unknown> = {}
let draftOwner: SceneNode | undefined
let disposed = false
function reset(): void {
  previous = structuredClone(properties)
  draftOwner = owner
  draft.value = Array.isArray(properties.suggestions)
    ? properties.suggestions.filter((value): value is string => typeof value === 'string')
    : []
}
watch(() => [owner, properties] as const, reset, { immediate: true, flush: 'sync' })
watch(() => active?.value, reset, { flush: 'sync' })
onScopeDispose(() => {
  disposed = true
})
const invalid = computed(() => parseInputSuggestions(draft.value) === undefined)
const dirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(previous.suggestions ?? [])
)
function apply(): void {
  if (disposed || active?.value === false || owner !== draftOwner || invalid.value || !dirty.value)
    return
  emit('commit', [...draft.value], draftOwner, previous)
}
</script>

<template>
  <div data-property="input-suggestions" class="flex flex-col gap-1.5">
    <div
      v-for="(_value, index) in draft"
      :key="index"
      class="flex items-center gap-1"
      data-slot="suggestion-row"
    >
      <AppInput
        :model-value="draft[index]"
        @update:model-value="draft[index] = String($event)"
        :ariaLabel="`${panels.lowcodeInputSuggestion} ${index + 1}`"
        spellcheck="false"
        class="min-w-0 flex-1"
      />
      <AppButton
        size="xs"
        variant="ghost"
        :aria-label="`${panels.lowcodeInteractiveOptionRemove} ${index + 1}`"
        @click="draft.splice(index, 1)"
      >
        <icon-lucide-x class="size-3" />
      </AppButton>
    </div>
    <div class="flex items-center gap-1">
      <AppButton
        size="xs"
        variant="ghost"
        :disabled="draft.length >= 100"
        @click="draft.push('')"
        >{{ panels.lowcodeInputSuggestionAdd }}</AppButton
      >
      <span class="ml-auto text-[10px] text-muted">{{ draft.length }}/100</span>
    </div>
    <p v-if="invalid" role="alert" class="text-[10px] text-error">
      {{ panels.lowcodeInputSuggestionsInvalid }}
    </p>
    <div class="flex gap-1">
      <AppButton size="xs" :disabled="!dirty || invalid" @click="apply">{{
        panels.lowcodeInputSuggestionsApply
      }}</AppButton>
      <AppButton size="xs" variant="ghost" :disabled="!dirty" @click="reset">{{
        panels.lowcodeInputSuggestionsCancel
      }}</AppButton>
    </div>
  </div>
</template>
