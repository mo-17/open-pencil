<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { TABS_MODULE_LIMITS, type TabsItemV1 } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import { usePanelMessages } from '@open-pencil/vue'

import type {
  TabsContentCanvas,
  TabsContentItemState,
  TabsContentRequest
} from '@/app/lowcode/tabs-content'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import {
  appendBoundedModuleEditorItem,
  nextModuleEditorItemId,
  removeBoundedModuleEditorItem,
  replaceModuleEditorItem
} from '@/app/plugins/module-items-editor-model'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

import ModuleContentChildSelect from './ModuleContentChildSelect.vue'

const {
  modelValue,
  label,
  addLabel,
  removeLabel,
  idLabel,
  titleLabel,
  contentLabel,
  contentChildOptions = [],
  contentChildCopy,
  canvas,
  newItemTitle,
  countLabel,
  itemLabel,
  invalid = false,
  error = ''
} = defineProps<{
  modelValue: readonly TabsItemV1[]
  label: string
  addLabel: string
  removeLabel: string
  idLabel: string
  titleLabel: string
  contentLabel: string
  contentChildOptions?: { value: string; label: string; disabled?: boolean }[]
  contentChildCopy?: AppPluginModuleEditorText
  canvas?: TabsContentCanvas
  newItemTitle: string
  countLabel?: (count: number, maximum: number) => string
  itemLabel?: (item: number) => string
  invalid?: boolean
  error?: string
}>()

const emit = defineEmits<{
  commit: [value: TabsItemV1[]]
  viewContent: [request: TabsContentRequest]
  editContent: [request: TabsContentRequest]
  resetPreview: [owner: SceneNode | undefined]
}>()

const draft = ref(cloneItems(modelValue))
const panels = usePanelMessages()
const owner = computed(() => canvas?.owner)

function contentState(item: TabsItemV1): TabsContentItemState | undefined {
  const current = canvas?.states[item.id]
  if (!item.contentChildName) return current?.mode === 'text' ? current : undefined
  if (draft.value.filter((tab) => tab.contentChildName === item.contentChildName).length !== 1)
    return { mode: 'invalid', canView: false, canEdit: false }
  return current?.contentChildName === item.contentChildName ? current : undefined
}

function contentRequest(item: TabsItemV1): TabsContentRequest {
  return { tabId: item.id, contentChildName: item.contentChildName, owner: owner.value }
}

watch(
  () => modelValue,
  (value) => {
    draft.value = cloneItems(value)
  },
  { deep: true }
)

function cloneItems(value: readonly TabsItemV1[]): TabsItemV1[] {
  return value.map((item) => ({
    id: item.id,
    label: item.label,
    content: item.content,
    ...(item.contentChildName !== undefined ? { contentChildName: item.contentChildName } : {})
  }))
}

function sameItems(left: readonly TabsItemV1[], right: readonly TabsItemV1[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.label === right[index]?.label &&
        item.content === right[index]?.content &&
        item.contentChildName === right[index]?.contentChildName
    )
  )
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function updateItem(index: number, key: keyof TabsItemV1, event: Event): void {
  const next = replaceModuleEditorItem(draft.value, index, (item) => ({
    ...item,
    [key]: eventValue(event)
  }))
  if (next) draft.value = next
}

function selectContentChild(index: number, value: string): void {
  const next = replaceModuleEditorItem(draft.value, index, (item) => ({
    ...item,
    contentChildName: value
  }))
  if (next) draft.value = next
  commit()
}

function commit(): void {
  if (!invalid && sameItems(draft.value, modelValue)) return
  emit('commit', cloneItems(draft.value))
}

function commitShortcut(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  commit()
}

function addItem(): void {
  const next = appendBoundedModuleEditorItem(
    draft.value,
    {
      id: nextModuleEditorItemId(draft.value, 'tab'),
      label: newItemTitle,
      content: ''
    },
    TABS_MODULE_LIMITS.tabsMax
  )
  if (!next) return
  draft.value = next
  commit()
}

function removeItem(index: number): void {
  const next = removeBoundedModuleEditorItem(draft.value, index, TABS_MODULE_LIMITS.tabsMin)
  if (!next) return
  draft.value = next
  commit()
}
</script>

<template>
  <div
    data-test-id="tabs-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex items-center gap-1">
      <button
        type="button"
        data-test-id="tabs-add-item"
        :disabled="draft.length >= TABS_MODULE_LIMITS.tabsMax"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="addItem"
      >
        {{ addLabel }}
      </button>
      <span data-test-id="tabs-item-count" class="ml-auto text-[9px] text-muted">
        {{
          countLabel
            ? countLabel(draft.length, TABS_MODULE_LIMITS.tabsMax)
            : `${draft.length}/${TABS_MODULE_LIMITS.tabsMax}`
        }}
      </span>
    </div>

    <div class="flex max-h-80 flex-col gap-1.5 overflow-auto">
      <fieldset
        v-for="(item, index) in draft"
        :key="index"
        data-test-id="tabs-item-row"
        class="rounded border border-border bg-input p-1.5"
      >
        <legend class="flex w-full items-center gap-1 px-0.5 text-[9px] font-medium text-muted">
          <span>{{ itemLabel ? itemLabel(index + 1) : `#${index + 1}` }}</span>
          <button
            type="button"
            data-test-id="tabs-remove-item"
            :disabled="draft.length <= TABS_MODULE_LIMITS.tabsMin"
            class="ml-auto rounded border border-transparent px-1.5 py-0.5 text-[9px] text-muted hover:border-border hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
            @click="removeItem(index)"
          >
            {{ removeLabel }}
          </button>
        </legend>

        <label class="mb-1 block text-[9px] text-muted">
          {{ idLabel }}
          <input
            :value="item.id"
            :maxlength="TABS_MODULE_LIMITS.id"
            data-test-id="tabs-item-id"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="mt-0.5 w-full rounded border border-border bg-input px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'id', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>

        <label class="mb-1 block text-[9px] text-muted">
          {{ titleLabel }}
          <input
            :value="item.label"
            :maxlength="TABS_MODULE_LIMITS.label"
            data-test-id="tabs-item-title"
            class="mt-0.5 w-full rounded border border-border bg-input px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'label', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>

        <div data-test-id="tabs-content-status">
          <p v-if="contentChildCopy" class="mb-0.5 text-[9px] text-muted">
            {{ panels.lowcodeTabsContentSource }}
          </p>
          <ModuleContentChildSelect
            v-if="contentChildCopy"
            :model-value="item.contentChildName ?? ''"
            :options="contentChildOptions"
            :copy="contentChildCopy"
            :show-missing-warning="false"
            @commit="selectContentChild(index, $event)"
          />
          <p
            v-if="item.contentChildName && contentState(item)?.mode === 'mapped'"
            class="my-1 text-[10px] leading-relaxed text-muted"
            data-test-id="tabs-mapped-content"
          >
            {{ panels.lowcodeTabsMappedContent({ name: item.contentChildName }) }}
          </p>
          <AppAlert
            v-else-if="item.contentChildName"
            tone="warning"
            :heading="panels.lowcodeTabsInvalidContent"
            data-test-id="tabs-invalid-content"
          />
          <AppAlert
            v-if="contentState(item)?.mode === 'mapped' && !contentState(item)?.canEdit"
            tone="info"
            :heading="panels.lowcodeTabsContentUnavailable"
          />
        </div>
        <label v-if="!item.contentChildName" class="block text-[9px] text-muted">
          {{ contentLabel }}
          <textarea
            :value="item.content"
            :maxlength="TABS_MODULE_LIMITS.content"
            data-test-id="tabs-item-content"
            rows="3"
            class="mt-0.5 w-full resize-y rounded border border-border bg-input px-1.5 py-1 text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'content', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>
        <div v-if="owner" class="mt-2 flex flex-wrap gap-1">
          <AppButton
            variant="outline"
            size="xs"
            data-test-id="tabs-view-content"
            :aria-pressed="canvas?.currentTabId === item.id"
            :color="canvas?.currentTabId === item.id ? 'primary' : 'neutral'"
            :disabled="!contentState(item)?.canView"
            @click="emit('viewContent', contentRequest(item))"
            >{{ panels.lowcodeTabsViewContent }}</AppButton
          >
          <AppButton
            v-if="item.contentChildName"
            variant="outline"
            size="xs"
            data-test-id="tabs-edit-content"
            :disabled="!contentState(item)?.canEdit"
            @click="emit('editContent', contentRequest(item))"
            >{{ panels.lowcodeTabsEditContent }}</AppButton
          >
        </div>
      </fieldset>
    </div>

    <p v-if="owner" class="text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeTabsViewHint }}
    </p>
    <AppButton
      v-if="canvas?.hasPreview"
      variant="ghost"
      size="xs"
      data-test-id="tabs-reset-preview"
      @click="emit('resetPreview', owner)"
      >{{ panels.lowcodeTabsReturnInitial }}</AppButton
    >

    <p v-if="error" data-test-id="tabs-items-error" class="text-[10px] text-red-400">
      {{ error }}
    </p>
  </div>
</template>
