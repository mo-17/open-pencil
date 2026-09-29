<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import { useDescriptionsDraft } from '@/app/lowcode/descriptions-editor/use'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

const { owner, config } = defineProps<{ owner?: SceneNode; config: JSONObject }>()
const emit = defineEmits<{ commit: [request: ModuleScalarCommit] }>()
const p = usePanelMessages()
const { rows, generation, invalid, dirty, begin, input, add, remove, cancel, apply } =
  useDescriptionsDraft(
    () => owner,
    () => config,
    (request) => emit('commit', request),
    useRetainedActivity()
  )
// Each VNode callback retains the generation it rendered, even after a new row takes focus.
const renderedRows = computed(() =>
  rows.value.map((row) => ({ ...row, generation: generation.value }))
)
function rendered(event: Event): number {
  const element = event.currentTarget
  return element instanceof Element
    ? Number(
        element
          .closest('[data-descriptions-generation]')
          ?.getAttribute('data-descriptions-generation') ?? -1
      )
    : -1
}
</script>

<template>
  <div
    :key="generation"
    :data-descriptions-generation="generation"
    data-test-id="descriptions-items-editor"
    class="flex flex-col gap-2"
    role="group"
    :aria-label="p.lowcodeModuleDescriptionsItems"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ p.lowcodeDescriptionsEditorHint }}</p>
    <span class="text-right text-[9px] text-muted">{{ rows.length }}/24</span>
    <div class="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
      <div
        v-for="(row, index) in renderedRows"
        :key="row.id"
        data-test-id="descriptions-item-row"
        class="flex flex-col gap-1 rounded border border-border bg-input p-2"
      >
        <div class="flex items-center justify-between gap-2">
          <label class="text-[10px] text-muted"
            >{{ index + 1 }} · {{ p.lowcodeModuleDescriptionsItemLabel }}</label
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="rows.length <= 1"
            :aria-label="p.lowcodeDescriptionsRemove"
            @click="remove(row.id, rendered($event))"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <AppInput
          :model-value="row.label"
          :ariaLabel="p.lowcodeModuleDescriptionsItemLabel"
          :maxlength="120"
          @focus="begin(row.id, rendered($event))"
          @update:model-value="input(row.id, 'label', $event, row.generation)"
        />
        <label class="text-[10px] text-muted">{{ p.lowcodeModuleDescriptionsItemValue }}</label>
        <textarea
          :value="row.value"
          :aria-label="p.lowcodeModuleDescriptionsItemValue"
          maxlength="1000"
          rows="3"
          class="min-w-0 resize-y rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @focus="begin(row.id, rendered($event))"
          @input="
            input(row.id, 'value', ($event.target as HTMLTextAreaElement).value, rendered($event))
          "
        />
      </div>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 24"
      @click="add(p.lowcodeDescriptionsNewItem, rendered($event))"
      >{{ p.lowcodeDescriptionsAdd }}</AppButton
    >
    <AppAlert v-if="invalid" tone="warning" :heading="p.lowcodeDescriptionsInvalid" />
    <p v-if="dirty" role="status" class="text-[10px] text-muted">
      {{ p.lowcodeDescriptionsPending }}
    </p>
    <div class="flex gap-2">
      <AppButton color="primary" size="xs" :disabled="!dirty" @click="apply(rendered($event))">{{
        p.lowcodeDescriptionsApply
      }}</AppButton>
      <AppButton variant="ghost" size="xs" :disabled="!dirty" @click="cancel(rendered($event))">{{
        p.lowcodeDescriptionsCancel
      }}</AppButton>
    </div>
  </div>
</template>
