<script setup lang="ts">
import { computed } from 'vue'

import type { StateDef, StateValueType } from '@open-pencil/core/scene-graph'
import { useI18n } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()

const pageId = computed(() => editor.state.currentPageId)
const states = computed<StateDef[]>(() => {
  const page = editor.graph.getNode(pageId.value)
  return page?.state ?? []
})

const TYPES: StateValueType[] = ['string', 'number', 'boolean']

function commitStates(next: StateDef[]): void {
  editor.updateNodeWithUndo(pageId.value, { state: next }, 'Update page state')
}

function addState(): void {
  const existing = new Set(states.value.map((s) => s.name))
  let name = 'count'
  let i = 1
  while (existing.has(name)) {
    i++
    name = `count${i}`
  }
  const def: StateDef = {
    id: crypto.randomUUID(),
    name,
    type: 'number',
    defaultValue: 0
  }
  commitStates([...states.value, def])
}

function removeState(id: string): void {
  commitStates(states.value.filter((s) => s.id !== id))
}

function renameState(id: string, value: string): void {
  commitStates(states.value.map((s) => (s.id === id ? { ...s, name: value } : s)))
}

function changeType(id: string, type: StateValueType): void {
  commitStates(
    states.value.map((s) => (s.id === id ? { ...s, type, defaultValue: defaultFor(type) } : s))
  )
}

function changeDefault(id: string, rawValue: string, type: StateValueType): void {
  commitStates(states.value.map((s) => (s.id === id ? { ...s, defaultValue: parseValue(rawValue, type) } : s)))
}

function defaultFor(type: StateValueType): unknown {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}

function parseValue(raw: string, type: StateValueType): unknown {
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'boolean') {
    return raw === 'true'
  }
  return raw
}

function defaultAsString(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  return String(value)
}
</script>

<template>
  <div data-test-id="lowcode-state-section" :class="sectionCls.wrapper">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="text-[11px] text-muted">{{ panels.lowcodeState }}</label>
      <button
        type="button"
        data-test-id="lowcode-state-add"
        class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="addState"
      >
        + {{ panels.lowcodeStateAdd }}
      </button>
    </div>

    <p v-if="states.length === 0" class="text-[11px] text-muted">
      {{ panels.lowcodeStateEmpty }}
    </p>

    <ul v-else class="flex flex-col gap-1.5">
      <li
        v-for="state in states"
        :key="state.id"
        data-test-id="lowcode-state-row"
        class="flex items-center gap-1"
      >
        <input
          :value="state.name"
          :aria-label="panels.lowcodeStateName"
          data-test-id="lowcode-state-name"
          class="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="renameState(state.id, ($event.target as HTMLInputElement).value)"
        />
        <select
          :value="state.type"
          :aria-label="panels.lowcodeStateType"
          data-test-id="lowcode-state-type"
          class="rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="changeType(state.id, ($event.target as HTMLSelectElement).value as StateValueType)"
        >
          <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <select
          v-if="state.type === 'boolean'"
          :value="defaultAsString(state.defaultValue)"
          :aria-label="panels.lowcodeStateDefault"
          data-test-id="lowcode-state-default"
          class="w-16 rounded border border-border bg-input px-1.5 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="changeDefault(state.id, ($event.target as HTMLSelectElement).value, 'boolean')"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
        <input
          v-else
          :value="defaultAsString(state.defaultValue)"
          :type="state.type === 'number' ? 'number' : 'text'"
          :aria-label="panels.lowcodeStateDefault"
          data-test-id="lowcode-state-default"
          class="w-20 rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="changeDefault(state.id, ($event.target as HTMLInputElement).value, state.type)"
        />
        <button
          type="button"
          :aria-label="panels.lowcodeStateAdd"
          data-test-id="lowcode-state-remove"
          class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
          @click="removeState(state.id)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </li>
    </ul>
  </div>
</template>
