<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity } from '@open-pencil/vue'

import type { TimelineEditorCommit } from '@/app/lowcode/timeline-editor'
import { timelineEditorCopy } from '@/app/lowcode/timeline-editor/copy'
import { useTimelineDraft } from '@/app/lowcode/timeline-editor/use'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { owner, config, label, copy } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  label: string
  copy: AppPluginModuleEditorText
}>()
const emit = defineEmits<{ commit: [request: TimelineEditorCommit] }>()
const { locale, panels } = useI18n()
const text = computed(() => timelineEditorCopy(locale.value))
const { draft, invalid, restore, beginInput, input, commit, edit, generation } = useTimelineDraft(
  () => owner,
  () => config,
  (request) => emit('commit', request),
  useRetainedActivity()
)
const statuses = computed(() =>
  (['completed', 'current', 'pending', 'error'] as const).map((value) => ({
    value,
    label: text.value[value]
  }))
)
const textFields = computed(
  () =>
    [
      { key: 'id', label: text.value.identifier, max: 64 },
      { key: 'title', label: text.value.title, max: 120 },
      { key: 'time', label: text.value.time, max: 80 }
    ] as const
)
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="flex flex-col gap-2"
    data-test-id="timeline-items-editor"
  >
    <p class="text-[10px] leading-relaxed text-muted">{{ text.hint }}</p>
    <span class="text-right text-[9px] text-muted">{{ copy.count(draft.length, 24) }}</span>
    <div class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(item, index) in draft"
        :key="index"
        class="min-w-0 rounded border border-border bg-input p-2"
        data-test-id="timeline-item-row"
      >
        <legend class="px-1 text-[10px] font-medium text-surface">
          {{ copy.item(index + 1) }}
        </legend>
        <div class="mb-2 flex justify-end gap-1">
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === 0"
            :aria-label="panels.lowcodeSelectMoveUp"
            @click="edit({ kind: 'move', index, offset: -1 })"
            ><icon-lucide-arrow-up class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === draft.length - 1"
            :aria-label="panels.lowcodeSelectMoveDown"
            @click="edit({ kind: 'move', index, offset: 1 })"
            ><icon-lucide-arrow-down class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :aria-label="copy.removeItem"
            @click="edit({ kind: 'remove', index })"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <label
          v-for="field in textFields"
          :key="field.key"
          class="mb-2 block text-[10px] text-muted"
        >
          {{ field.label }}
          <AppInput
            :model-value="item[field.key]"
            :ariaLabel="field.label"
            :maxlength="field.max"
            @focus="beginInput"
            @update:model-value="input(index, field.key, $event)"
            @change="commit"
            @enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="restore"
          />
        </label>
        <label class="mb-2 block text-[10px] text-muted">
          {{ text.description }}
          <AppTextarea
            :model-value="item.description"
            :aria-label="text.description"
            :maxlength="600"
            :rows="3"
            @focus="beginInput"
            @update:model-value="input(index, 'description', $event)"
            @blur="commit"
            @keydown.ctrl.enter.prevent="commit"
            @keydown.meta.enter.prevent="commit"
            @keydown.esc="restore"
          />
        </label>
        <AppSelect
          :key="`${generation}:${item.id}`"
          :model-value="item.status"
          :options="statuses"
          :label="text.status"
          @update:model-value="edit({ kind: 'status', index, id: item.id, value: $event })"
        />
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="draft.length >= 24"
      @click="edit({ kind: 'add', title: text.newEvent })"
      >{{ text.add }}</AppButton
    >
    <AppAlert v-if="invalid" tone="warning" :heading="text.invalid" />
    <AppButton v-if="invalid" variant="ghost" size="xs" @click="restore">{{
      text.restore
    }}</AppButton>
  </div>
</template>
