<script setup lang="ts">
import { computed } from 'vue'

import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

// Phase 3 §3.v4 step 7 — interactiveProps editor for SELECT and RADIO.
// Both render their options from `interactiveProps.options: string[]`;
// RADIO additionally needs `interactiveProps.groupName: string` so the
// emitted `<input type="radio" name={groupName}>` groups correctly. UI
// gap originally surfaced by §3.v4 ACK #5/#6 — controlled binding
// wiring (value=) worked end-to-end but Preview showed an empty <select>
// / zero radios because there was no way to author the options.

interface OptionsInteractiveProps {
  options?: string[]
  groupName?: string
  value?: string
}

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()

const isRadio = computed(() => selectedNode.value?.type === 'RADIO')

const ip = useSceneComputed<OptionsInteractiveProps>(
  () => (selectedNode.value?.interactiveProps ?? {}) as OptionsInteractiveProps
)

const options = computed<string[]>(() => {
  const raw = ip.value.options
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === 'string') : []
})

const groupName = computed(() => (typeof ip.value.groupName === 'string' ? ip.value.groupName : ''))

function commit(patch: Partial<OptionsInteractiveProps>): void {
  const node = selectedNode.value
  if (!node) return
  const merged: OptionsInteractiveProps = { ...ip.value, ...patch }
  editor.updateNodeWithUndo(
    node.id,
    { interactiveProps: merged as Record<string, unknown> },
    'Update options'
  )
}

function addOption(): void {
  commit({ options: [...options.value, ''] })
}

function removeOption(index: number): void {
  commit({ options: options.value.filter((_, i) => i !== index) })
}

function updateOption(index: number, value: string): void {
  commit({ options: options.value.map((o, i) => (i === index ? value : o)) })
}

function updateGroupName(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  commit({ groupName: value === '' ? undefined : value })
}
</script>

<template>
  <div data-test-id="lowcode-interactive-options" :class="sectionCls.wrapper">
    <label class="mb-1.5 block text-[11px] text-muted">
      {{ panels.lowcodeInteractiveOptions }}
    </label>

    <div
      v-if="isRadio"
      data-test-id="lowcode-interactive-group-name-row"
      class="mb-1.5 flex items-center gap-1"
    >
      <label class="w-20 text-[10px] text-muted">{{ panels.lowcodeInteractiveGroupName }}</label>
      <input
        :value="groupName"
        :aria-label="panels.lowcodeInteractiveGroupName"
        data-test-id="lowcode-interactive-group-name"
        spellcheck="false"
        :placeholder="panels.lowcodeInteractiveGroupNamePlaceholder"
        class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
        @change="updateGroupName"
      />
    </div>

    <div class="flex flex-col gap-1">
      <div
        v-for="(opt, i) in options"
        :key="i"
        data-test-id="lowcode-interactive-option"
        class="flex items-center gap-1"
      >
        <input
          :value="opt"
          :aria-label="panels.lowcodeInteractiveOptionValue"
          data-test-id="lowcode-interactive-option-input"
          spellcheck="false"
          :placeholder="panels.lowcodeInteractiveOptionPlaceholder"
          class="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-0.5 text-[11px] text-surface outline-none focus:border-accent"
          @change="updateOption(i, ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          :aria-label="panels.lowcodeInteractiveOptionRemove"
          data-test-id="lowcode-interactive-option-remove"
          class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
          @click="removeOption(i)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>
      <button
        type="button"
        data-test-id="lowcode-interactive-option-add"
        class="self-start rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addOption"
      >
        + {{ panels.lowcodeInteractiveOptionAdd }}
      </button>
    </div>
  </div>
</template>
