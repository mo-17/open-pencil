<script setup lang="ts">
import { ACCORDION_MODULE_LIMITS } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { usePanelMessages, useRetainedActivity } from '@open-pencil/vue'

import type { AccordionEditorCommit } from '@/app/lowcode/accordion-editor'
import { useAccordionEditorDraft } from '@/app/lowcode/accordion-editor/use'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

const { owner, config, label, copy } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  label: string
  copy: AppPluginModuleEditorText
}>()
const emit = defineEmits<{ commit: [request: AccordionEditorCommit] }>()
const panels = usePanelMessages()
const active = useRetainedActivity()
const { draft, invalid, restore, beginInput, input, commit, edit } = useAccordionEditorDraft(
  () => owner,
  () => config,
  (request) => emit('commit', request),
  active
)
</script>

<template>
  <div
    data-test-id="accordion-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-2"
  >
    <label class="flex items-center gap-2 text-[10px] text-surface">
      <AppCheckbox
        :model-value="draft.allowMultiple"
        :ariaLabel="panels.lowcodeAccordionAllowMultiple"
        data-test-id="accordion-allow-multiple"
        @update:model-value="edit({ kind: 'multiple', value: $event })"
      />
      {{ panels.lowcodeAccordionAllowMultiple }}
    </label>
    <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeAccordionInitialHint }}</p>
    <span data-test-id="accordion-item-count" class="text-right text-[9px] text-muted">
      {{ copy.count(draft.items.length, ACCORDION_MODULE_LIMITS.itemsMax) }}
    </span>
    <div class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(item, index) in draft.items"
        :key="index"
        data-test-id="accordion-item-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] font-medium text-surface">
          {{ copy.item(index + 1) }}
        </legend>
        <div class="mb-2 flex items-center gap-1">
          <label class="mr-auto flex items-center gap-2 text-[10px] text-surface">
            <AppCheckbox
              :model-value="draft.initialOpenIndexes.includes(index)"
              :ariaLabel="panels.lowcodeAccordionInitialOpen"
              data-test-id="accordion-initial-open"
              @update:model-value="edit({ kind: 'open', index, value: $event })"
            />
            {{ panels.lowcodeAccordionInitialOpen }}
          </label>
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="accordion-move-up"
            :disabled="index === 0"
            :aria-label="panels.lowcodeSelectMoveUp"
            @click="edit({ kind: 'move', index, offset: -1 })"
            ><icon-lucide-arrow-up class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="accordion-move-down"
            :disabled="index === draft.items.length - 1"
            :aria-label="panels.lowcodeSelectMoveDown"
            @click="edit({ kind: 'move', index, offset: 1 })"
            ><icon-lucide-arrow-down class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            data-test-id="accordion-remove-item"
            :disabled="draft.items.length <= ACCORDION_MODULE_LIMITS.itemsMin"
            :aria-label="copy.removeItem"
            @click="edit({ kind: 'remove', index })"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <label
          v-for="field in ['id', 'title', 'content'] as const"
          :key="field"
          class="mb-1.5 block text-[10px] text-muted"
        >
          {{ field === 'id' ? copy.identifier : field === 'title' ? copy.title : copy.content }}
          <AppTextarea
            v-if="field === 'content'"
            :model-value="item.content"
            :rows="3"
            :aria-label="copy.content"
            :maxlength="ACCORDION_MODULE_LIMITS.content"
            data-test-id="accordion-item-content"
            @focus="beginInput"
            @update:model-value="input(index, field, $event)"
            @blur="commit"
            @keydown.ctrl.enter.prevent="commit"
            @keydown.meta.enter.prevent="commit"
            @keydown.esc="restore"
          />
          <AppInput
            v-else
            :model-value="item[field]"
            :ariaLabel="field === 'id' ? copy.identifier : copy.title"
            :maxlength="ACCORDION_MODULE_LIMITS[field]"
            :data-test-id="`accordion-item-${field}`"
            @focus="beginInput"
            @update:model-value="input(index, field, $event)"
            @change="commit"
            @enter="($event.target as HTMLInputElement).blur()"
            @keydown.ctrl.enter.prevent="commit"
            @keydown.meta.enter.prevent="commit"
            @keydown.esc="restore"
          />
        </label>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      data-test-id="accordion-add-item"
      :disabled="draft.items.length >= ACCORDION_MODULE_LIMITS.itemsMax"
      @click="edit({ kind: 'add', title: copy.newSection })"
      >{{ copy.addItem }}</AppButton
    >
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="panels.lowcodeAccordionInvalidDraft"
      data-test-id="accordion-draft-error"
    />
    <AppButton
      v-if="invalid"
      variant="ghost"
      size="xs"
      data-test-id="accordion-restore"
      @click="restore"
      >{{ panels.lowcodeAccordionRestore }}</AppButton
    >
  </div>
</template>
