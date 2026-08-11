<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import {
  DROPDOWN_MENU_MODULE_LIMITS,
  type DropdownMenuEntryV1,
  type DropdownMenuItemV1
} from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

const {
  modelValue,
  label,
  invalid = false
} = defineProps<{
  modelValue: readonly DropdownMenuEntryV1[]
  label: string
  invalid?: boolean
}>()

const emit = defineEmits<{
  commit: [value: DropdownMenuEntryV1[]]
}>()

const { panels } = useI18n()
const draft = ref(cloneEntries(modelValue))
const editorRoot = ref<HTMLElement | null>(null)
const addItemButton = ref<HTMLButtonElement | null>(null)

watch(
  () => modelValue,
  (value) => {
    draft.value = cloneEntries(value)
  },
  { deep: true }
)

function cloneEntries(value: readonly DropdownMenuEntryV1[]): DropdownMenuEntryV1[] {
  return value.map((entry) =>
    entry.type === 'separator'
      ? { type: 'separator' }
      : {
          type: 'item',
          label: entry.label,
          href: entry.href,
          disabled: entry.disabled,
          danger: entry.danger,
          shortcut: entry.shortcut
        }
  )
}

function sameEntries(
  left: readonly DropdownMenuEntryV1[],
  right: readonly DropdownMenuEntryV1[]
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index]
      if (!candidate || entry.type !== candidate.type) return false
      if (entry.type === 'separator') return true
      return (
        candidate.type === 'item' &&
        entry.label === candidate.label &&
        entry.href === candidate.href &&
        entry.disabled === candidate.disabled &&
        entry.danger === candidate.danger &&
        entry.shortcut === candidate.shortcut
      )
    })
  )
}

function itemCount(): number {
  return draft.value.filter((entry) => entry.type === 'item').length
}

function commit(): void {
  if (!invalid && sameEntries(draft.value, modelValue)) return
  emit('commit', cloneEntries(draft.value))
}

function commitShortcut(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
  event.preventDefault()
  commit()
}

function itemAt(index: number): DropdownMenuItemV1 | undefined {
  const entry = draft.value[index]
  return entry?.type === 'item' ? entry : undefined
}

function updateText(index: number, key: 'label' | 'href' | 'shortcut', event: Event): void {
  const item = itemAt(index)
  if (item) item[key] = (event.target as HTMLInputElement).value
}

function updateBoolean(index: number, key: 'disabled' | 'danger', event: Event): void {
  const item = itemAt(index)
  if (!item) return
  item[key] = (event.target as HTMLInputElement).checked
  commit()
}

function addItem(): void {
  if (draft.value.length >= DROPDOWN_MENU_MODULE_LIMITS.itemsMax) return
  draft.value.push({
    type: 'item',
    label: panels.value.lowcodeDropdownMenuNewItem,
    href: '',
    disabled: false,
    danger: false,
    shortcut: ''
  })
  commit()
}

function addSeparator(): void {
  if (draft.value.length >= DROPDOWN_MENU_MODULE_LIMITS.itemsMax) return
  draft.value.push({ type: 'separator' })
  commit()
}

function canDelete(index: number): boolean {
  return (
    draft.value[index]?.type === 'separator' || itemCount() > DROPDOWN_MENU_MODULE_LIMITS.itemsMin
  )
}

async function deleteEntry(index: number): Promise<void> {
  if (!canDelete(index)) return
  draft.value.splice(index, 1)
  const adjacentIndex = Math.min(index, draft.value.length - 1)
  commit()
  await nextTick()
  const adjacentControl = editorRoot.value?.querySelector<HTMLElement>(
    `[data-dropdown-entry-index="${adjacentIndex}"] [data-dropdown-entry-focus]`
  )
  const focusTarget = adjacentControl ?? addItemButton.value
  focusTarget?.focus()
}
</script>

<template>
  <div
    ref="editorRoot"
    data-test-id="dropdown-menu-items-editor"
    role="group"
    :aria-label="label"
    class="flex flex-col gap-1.5"
  >
    <div class="flex flex-wrap items-center gap-1">
      <button
        ref="addItemButton"
        type="button"
        data-test-id="dropdown-menu-add-item"
        :disabled="draft.length >= DROPDOWN_MENU_MODULE_LIMITS.itemsMax"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        @click="addItem"
      >
        {{ panels.lowcodeDropdownMenuAddItem }}
      </button>
      <button
        type="button"
        data-test-id="dropdown-menu-add-separator"
        :disabled="draft.length >= DROPDOWN_MENU_MODULE_LIMITS.itemsMax"
        class="rounded border border-border px-1.5 py-1 text-[10px] text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        @click="addSeparator"
      >
        {{ panels.lowcodeDropdownMenuAddSeparator }}
      </button>
      <span class="ml-auto text-[9px] text-muted">
        {{
          panels.lowcodeDropdownMenuEntryCount({
            count: draft.length,
            max: DROPDOWN_MENU_MODULE_LIMITS.itemsMax
          })
        }}
      </span>
    </div>

    <div class="flex max-h-96 flex-col gap-1.5 overflow-auto">
      <template v-for="(entry, index) in draft" :key="index">
        <details
          v-if="entry.type === 'item'"
          :open="index === 0"
          :data-dropdown-entry-index="index"
          data-test-id="dropdown-menu-item-row"
          class="rounded border border-border bg-input"
        >
          <summary
            data-dropdown-entry-focus
            data-test-id="dropdown-menu-item-summary"
            class="flex cursor-pointer list-none items-center gap-1 px-1.5 py-1.5 text-[9px] text-surface marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <span class="shrink-0 font-medium">
              {{ panels.lowcodeDropdownMenuItemNumber({ item: index + 1 }) }}
            </span>
            <span class="min-w-0 flex-1 truncate text-muted">{{ entry.label }}</span>
            <span
              v-if="entry.disabled"
              class="rounded border border-border px-1 py-0.5 text-[8px] text-muted"
            >
              {{ panels.lowcodeDropdownMenuItemDisabled }}
            </span>
            <span
              v-if="entry.danger"
              class="rounded border border-red-500/50 px-1 py-0.5 text-[8px] text-red-400"
            >
              {{ panels.lowcodeDropdownMenuItemDanger }}
            </span>
          </summary>

          <fieldset class="flex flex-col gap-1.5 border-t border-border p-1.5">
            <legend class="sr-only">
              {{ panels.lowcodeDropdownMenuItemNumber({ item: index + 1 }) }}
            </legend>
            <label class="block text-[9px] text-muted">
              {{ panels.lowcodeDropdownMenuItemLabel }}
              <input
                :value="entry.label"
                :maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemLabel"
                :aria-label="panels.lowcodeDropdownMenuItemLabelNumber({ item: index + 1 })"
                data-test-id="dropdown-menu-item-label"
                required
                class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-input placeholder:text-input/60 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                @input="updateText(index, 'label', $event)"
                @blur="commit"
                @keydown="commitShortcut"
              />
            </label>
            <label class="block text-[9px] text-muted">
              {{ panels.lowcodeDropdownMenuItemHref }}
              <input
                :value="entry.href"
                :maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemHref"
                :aria-label="panels.lowcodeDropdownMenuItemHrefNumber({ item: index + 1 })"
                data-test-id="dropdown-menu-item-href"
                spellcheck="false"
                class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 font-mono text-[10px] text-input placeholder:text-input/60 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                @input="updateText(index, 'href', $event)"
                @blur="commit"
                @keydown="commitShortcut"
              />
            </label>
            <label class="block text-[9px] text-muted">
              {{ panels.lowcodeDropdownMenuItemShortcut }}
              <input
                :value="entry.shortcut"
                :maxlength="DROPDOWN_MENU_MODULE_LIMITS.itemShortcut"
                :aria-label="panels.lowcodeDropdownMenuItemShortcutNumber({ item: index + 1 })"
                data-test-id="dropdown-menu-item-shortcut"
                class="mt-0.5 w-full rounded border border-border bg-surface px-1.5 py-1 font-mono text-[10px] text-input placeholder:text-input/60 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                @input="updateText(index, 'shortcut', $event)"
                @blur="commit"
                @keydown="commitShortcut"
              />
            </label>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label class="flex items-center gap-1 text-[9px] text-surface">
                <input
                  type="checkbox"
                  :checked="entry.disabled"
                  data-test-id="dropdown-menu-item-disabled"
                  class="size-3.5 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  @change="updateBoolean(index, 'disabled', $event)"
                />
                <span>{{ panels.lowcodeDropdownMenuItemDisabled }}</span>
              </label>
              <label class="flex items-center gap-1 text-[9px] text-surface">
                <input
                  type="checkbox"
                  :checked="entry.danger"
                  data-test-id="dropdown-menu-item-danger"
                  class="size-3.5 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  @change="updateBoolean(index, 'danger', $event)"
                />
                <span>{{ panels.lowcodeDropdownMenuItemDanger }}</span>
              </label>
              <button
                type="button"
                data-test-id="dropdown-menu-delete-entry"
                :disabled="!canDelete(index)"
                :aria-label="panels.lowcodeDropdownMenuDeleteEntry({ item: index + 1 })"
                class="ml-auto rounded border border-border px-1.5 py-1 text-[9px] text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
                @click="deleteEntry(index)"
              >
                {{ panels.lowcodeDropdownMenuDelete }}
              </button>
            </div>
          </fieldset>
        </details>

        <div
          v-else
          :data-dropdown-entry-index="index"
          data-test-id="dropdown-menu-separator-row"
          role="group"
          :aria-label="panels.lowcodeDropdownMenuSeparatorNumber({ item: index + 1 })"
          class="flex items-center gap-1 rounded border border-border bg-input px-1.5 py-1.5"
        >
          <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
          <span class="text-[9px] text-muted">
            {{ panels.lowcodeDropdownMenuSeparatorNumber({ item: index + 1 }) }}
          </span>
          <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
          <button
            data-dropdown-entry-focus
            type="button"
            data-test-id="dropdown-menu-delete-entry"
            :aria-label="panels.lowcodeDropdownMenuDeleteEntry({ item: index + 1 })"
            class="rounded border border-border px-1.5 py-1 text-[9px] text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            @click="deleteEntry(index)"
          >
            {{ panels.lowcodeDropdownMenuDelete }}
          </button>
        </div>
      </template>
    </div>

    <p class="text-[9px] leading-relaxed text-muted">
      {{ panels.lowcodeDropdownMenuHrefHint }}
      {{ panels.lowcodeDropdownMenuMinimumItemHint }}
    </p>
  </div>
</template>
