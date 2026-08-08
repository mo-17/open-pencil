<script setup lang="ts">
import { ref, watch } from 'vue'

import { SLIDE_MENU_MODULE_LIMITS, type SlideMenuItemV1 } from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

const {
  modelValue,
  label,
  invalid = false
} = defineProps<{
  modelValue: readonly SlideMenuItemV1[]
  label: string
  invalid?: boolean
}>()

const emit = defineEmits<{
  commit: [value: SlideMenuItemV1[]]
}>()

const { panels } = useI18n()
const draft = ref(cloneItems(modelValue))

watch(
  () => modelValue,
  (value) => {
    draft.value = cloneItems(value)
  },
  { deep: true }
)

function cloneItems(value: readonly SlideMenuItemV1[]): SlideMenuItemV1[] {
  return value.map((item) => ({ label: item.label, href: item.href }))
}

function sameItems(left: readonly SlideMenuItemV1[], right: readonly SlideMenuItemV1[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) => item.label === right[index]?.label && item.href === right[index]?.href
    )
  )
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

function eventValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function updateItem(index: number, key: 'label' | 'href', event: Event): void {
  const item = draft.value[index]
  if (item) item[key] = eventValue(event)
}

function addItem(): void {
  if (draft.value.length >= SLIDE_MENU_MODULE_LIMITS.items) return
  draft.value.push({
    label: panels.value.lowcodeSlideMenuNewItem,
    href: '#section'
  })
  commit()
}

function deleteItem(index: number): void {
  draft.value.splice(index, 1)
  commit()
}
</script>

<template>
  <div
    data-test-id="slide-menu-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex items-center gap-1">
      <button
        type="button"
        data-test-id="slide-menu-add-item"
        :disabled="draft.length >= SLIDE_MENU_MODULE_LIMITS.items"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="addItem"
      >
        {{ panels.lowcodeSlideMenuAddItem }}
      </button>
      <span class="ml-auto text-[9px] text-muted">
        {{
          panels.lowcodeSlideMenuItemCount({
            count: draft.length,
            max: SLIDE_MENU_MODULE_LIMITS.items
          })
        }}
      </span>
    </div>

    <div class="flex max-h-80 flex-col gap-1.5 overflow-auto">
      <div
        v-for="(item, index) in draft"
        :key="index"
        data-test-id="slide-menu-item-row"
        class="rounded border border-border bg-input p-1.5"
      >
        <div class="mb-1 flex items-center gap-1">
          <span class="text-[9px] font-medium text-muted">
            {{ panels.lowcodeSlideMenuItemNumber({ item: index + 1 }) }}
          </span>
          <button
            type="button"
            data-test-id="slide-menu-delete-item"
            :aria-label="panels.lowcodeSlideMenuDeleteItem({ item: index + 1 })"
            class="ml-auto rounded px-1 text-xs text-muted hover:bg-hover"
            @click="deleteItem(index)"
          >
            ×
          </button>
        </div>
        <label class="mb-1 block text-[9px] text-muted">
          {{ panels.lowcodeSlideMenuItemLabel }}
          <input
            :value="item.label"
            :maxlength="SLIDE_MENU_MODULE_LIMITS.itemLabel"
            :aria-label="panels.lowcodeSlideMenuItemLabelNumber({ item: index + 1 })"
            data-test-id="slide-menu-item-label"
            class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'label', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>
        <label class="block text-[9px] text-muted">
          {{ panels.lowcodeSlideMenuItemHref }}
          <input
            :value="item.href"
            :maxlength="SLIDE_MENU_MODULE_LIMITS.itemHref"
            :aria-label="panels.lowcodeSlideMenuItemHrefNumber({ item: index + 1 })"
            data-test-id="slide-menu-item-href"
            spellcheck="false"
            class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 font-mono text-[10px] text-surface outline-none focus:border-accent"
            @input="updateItem(index, 'href', $event)"
            @blur="commit"
            @keydown="commitShortcut"
          />
        </label>
      </div>
    </div>

    <p class="text-[9px] leading-relaxed text-muted">
      {{ panels.lowcodeSlideMenuHrefHint }}
    </p>
  </div>
</template>
