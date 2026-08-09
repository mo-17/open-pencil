<script setup lang="ts">
import { ref, watch } from 'vue'

import { ACCORDION_MODULE_LIMITS, type AccordionItemV1 } from '@open-pencil/core/plugins'

import {
  appendBoundedModuleEditorItem,
  nextModuleEditorItemId,
  removeBoundedModuleEditorItem,
  replaceModuleEditorItem
} from '@/app/plugins/module-items-editor-model'

const {
  modelValue,
  label,
  addLabel,
  removeLabel,
  idLabel,
  titleLabel,
  contentLabel,
  newItemTitle,
  countLabel,
  itemLabel,
  invalid = false,
  error = ''
} = defineProps<{
  modelValue: readonly AccordionItemV1[]
  label: string
  addLabel: string
  removeLabel: string
  idLabel: string
  titleLabel: string
  contentLabel: string
  newItemTitle: string
  countLabel?: (count: number, maximum: number) => string
  itemLabel?: (item: number) => string
  invalid?: boolean
  error?: string
}>()

const emit = defineEmits<{
  commit: [value: AccordionItemV1[]]
}>()

const draft = ref(cloneItems(modelValue))

watch(
  () => modelValue,
  (value) => {
    draft.value = cloneItems(value)
  },
  { deep: true }
)

function cloneItems(value: readonly AccordionItemV1[]): AccordionItemV1[] {
  return value.map((item) => ({ id: item.id, title: item.title, content: item.content }))
}

function sameItems(left: readonly AccordionItemV1[], right: readonly AccordionItemV1[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.title === right[index]?.title &&
        item.content === right[index]?.content
    )
  )
}

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value
}

function updateItem(index: number, key: keyof AccordionItemV1, event: Event): void {
  const next = replaceModuleEditorItem(draft.value, index, (item) => ({
    ...item,
    [key]: eventValue(event)
  }))
  if (next) draft.value = next
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
      id: nextModuleEditorItemId(draft.value, 'section'),
      title: newItemTitle,
      content: ''
    },
    ACCORDION_MODULE_LIMITS.itemsMax
  )
  if (!next) return
  draft.value = next
  commit()
}

function removeItem(index: number): void {
  const next = removeBoundedModuleEditorItem(draft.value, index, ACCORDION_MODULE_LIMITS.itemsMin)
  if (!next) return
  draft.value = next
  commit()
}
</script>

<template>
  <div
    data-test-id="accordion-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex items-center gap-1">
      <button
        type="button"
        data-test-id="accordion-add-item"
        :disabled="draft.length >= ACCORDION_MODULE_LIMITS.itemsMax"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="addItem"
      >
        {{ addLabel }}
      </button>
      <span data-test-id="accordion-item-count" class="ml-auto text-[9px] text-muted">
        {{
          countLabel
            ? countLabel(draft.length, ACCORDION_MODULE_LIMITS.itemsMax)
            : `${draft.length}/${ACCORDION_MODULE_LIMITS.itemsMax}`
        }}
      </span>
    </div>

    <div class="flex max-h-80 flex-col gap-1.5 overflow-auto">
      <fieldset
        v-for="(item, index) in draft"
        :key="index"
        data-test-id="accordion-item-row"
        class="rounded border border-border bg-input p-1.5"
      >
        <legend class="flex w-full items-center gap-1 px-0.5 text-[9px] font-medium text-muted">
          <span>{{ itemLabel ? itemLabel(index + 1) : `#${index + 1}` }}</span>
          <button
            type="button"
            data-test-id="accordion-remove-item"
            :disabled="draft.length <= ACCORDION_MODULE_LIMITS.itemsMin"
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
            :maxlength="ACCORDION_MODULE_LIMITS.id"
            data-test-id="accordion-item-id"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'id', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>

        <label class="mb-1 block text-[9px] text-muted">
          {{ titleLabel }}
          <input
            :value="item.title"
            :maxlength="ACCORDION_MODULE_LIMITS.title"
            data-test-id="accordion-item-title"
            class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'title', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>

        <label class="block text-[9px] text-muted">
          {{ contentLabel }}
          <textarea
            :value="item.content"
            :maxlength="ACCORDION_MODULE_LIMITS.content"
            data-test-id="accordion-item-content"
            rows="3"
            class="mt-0.5 w-full resize-y rounded border border-border bg-surface px-1.5 py-1 text-[10px] leading-relaxed text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'content', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>
      </fieldset>
    </div>

    <p v-if="error" data-test-id="accordion-items-error" class="text-[10px] text-red-400">
      {{ error }}
    </p>
  </div>
</template>
