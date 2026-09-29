<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity } from '@open-pencil/vue'

import type { NavigationEditorCommit } from '@/app/lowcode/navigation-editor'
import { navigationEditorCopy } from '@/app/lowcode/navigation-editor/copy'
import { useNavigationEditorDraft } from '@/app/lowcode/navigation-editor/use'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'

const { owner, config, label, copy } = defineProps<{
  owner?: SceneNode
  config: JSONObject
  label: string
  copy: AppPluginModuleEditorText
}>()
const emit = defineEmits<{ commit: [request: NavigationEditorCommit] }>()
const { locale, panels } = useI18n()
const text = computed(() => navigationEditorCopy(locale.value))
const active = useRetainedActivity()
const { draft, invalid, restore, beginInput, input, commit, edit } = useNavigationEditorDraft(
  () => owner,
  () => config,
  (request) => emit('commit', request),
  active
)
const rows = computed(() =>
  draft.value.kind === 'stepper'
    ? draft.value.items.map((item) => ({
        label: item.title,
        description: item.description,
        href: '',
        status: item.status,
        disabled: item.disabled
      }))
    : draft.value.items.map((item) => ({
        label: item.label,
        description: '',
        href: item.href,
        status: 'auto' as const,
        disabled: false
      }))
)
const statuses = computed(() =>
  (['auto', 'completed', 'error'] as const).map((value) => ({ value, label: text.value[value] }))
)
</script>

<template>
  <div
    data-test-id="navigation-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-2"
  >
    <p class="text-[10px] leading-relaxed text-muted">
      {{ draft.kind === 'stepper' ? text.stepperHint : text.breadcrumbHint }}
    </p>
    <span class="text-right text-[9px] text-muted">{{ copy.count(rows.length, 12) }}</span>
    <div class="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
      <fieldset
        v-for="(item, index) in rows"
        :key="index"
        data-test-id="navigation-item-row"
        class="min-w-0 rounded border border-border bg-input p-2"
      >
        <legend class="px-1 text-[10px] font-medium text-surface">
          {{ copy.item(index + 1) }}
        </legend>
        <div class="mb-2 flex items-center gap-1">
          <AppButton
            v-if="draft.kind === 'stepper'"
            size="xs"
            color="primary"
            :variant="draft.currentIndex === index ? 'solid' : 'outline'"
            :aria-pressed="draft.currentIndex === index"
            data-test-id="navigation-current-item"
            class="mr-auto"
            @click="edit({ kind: 'current', index })"
            >{{ text.current }}</AppButton
          >
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === 0"
            :aria-label="panels.lowcodeSelectMoveUp"
            data-test-id="navigation-move-up"
            @click="edit({ kind: 'move', index, offset: -1 })"
            ><icon-lucide-arrow-up class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="index === rows.length - 1"
            :aria-label="panels.lowcodeSelectMoveDown"
            data-test-id="navigation-move-down"
            @click="edit({ kind: 'move', index, offset: 1 })"
            ><icon-lucide-arrow-down class="size-3"
          /></AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="rows.length <= 1"
            :aria-label="copy.removeItem"
            data-test-id="navigation-remove-item"
            @click="edit({ kind: 'remove', index })"
            ><icon-lucide-x class="size-3"
          /></AppButton>
        </div>
        <label class="mb-2 block text-[10px] text-muted"
          >{{ text.title }}
          <AppInput
            :model-value="item.label"
            :ariaLabel="text.title"
            :maxlength="120"
            data-test-id="navigation-item-title"
            @focus="beginInput"
            @update:model-value="input(index, draft.kind === 'stepper' ? 'title' : 'label', $event)"
            @change="commit"
            @enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="restore"
          />
        </label>
        <template v-if="draft.kind === 'stepper'">
          <label class="mb-2 block text-[10px] text-muted"
            >{{ text.description }}
            <AppTextarea
              :model-value="item.description"
              :aria-label="text.description"
              :maxlength="240"
              :rows="2"
              data-test-id="navigation-item-description"
              @focus="beginInput"
              @update:model-value="input(index, 'description', $event)"
              @blur="commit"
              @keydown.ctrl.enter.prevent="commit"
              @keydown.meta.enter.prevent="commit"
              @keydown.esc="restore"
            />
          </label>
          <AppSelect
            :model-value="item.status"
            :options="statuses"
            :label="text.status"
            data-test-id="navigation-item-status"
            @update:model-value="edit({ kind: 'status', index, value: $event })"
          />
          <label class="mt-2 flex items-center gap-2 text-[10px] text-surface"
            ><AppCheckbox
              :model-value="item.disabled"
              :ariaLabel="text.disabled"
              data-test-id="navigation-item-disabled"
              @update:model-value="edit({ kind: 'disabled', index, value: $event })"
            />{{ text.disabled }}</label
          >
        </template>
        <label v-else class="block text-[10px] text-muted"
          >{{ text.href }}
          <AppInput
            :model-value="item.href"
            :ariaLabel="text.href"
            :maxlength="2048"
            spellcheck="false"
            data-test-id="navigation-item-href"
            @focus="beginInput"
            @update:model-value="input(index, 'href', $event)"
            @change="commit"
            @enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="restore"
          />
        </label>
      </fieldset>
    </div>
    <AppButton
      variant="outline"
      size="xs"
      :disabled="rows.length >= 12"
      data-test-id="navigation-add-item"
      @click="edit({ kind: 'add', title: text.newItem })"
      >{{ copy.addItem }}</AppButton
    >
    <AppAlert
      v-if="invalid"
      tone="warning"
      :heading="text.invalid"
      data-test-id="navigation-draft-error"
    />
    <AppButton v-if="invalid" variant="ghost" size="xs" @click="restore">{{
      text.restore
    }}</AppButton>
  </div>
</template>
