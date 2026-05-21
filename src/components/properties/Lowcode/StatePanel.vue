<script setup lang="ts">
import { computed, ref } from 'vue'

import { validateStateName } from '@open-pencil/compiler'
import type { StateDef, StateValueType } from '@open-pencil/core/scene-graph'
import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()

const pageId = computed(() => editor.state.currentPageId)
const states = useSceneComputed<StateDef[]>(() => {
  const page = editor.graph.getNode(editor.state.currentPageId)
  return page?.state ?? []
})

const TYPES: StateValueType[] = ['string', 'number', 'boolean', 'array', 'object']

// Per-row JSON parse errors for array / object defaults. Populated on a
// failed `@change` and cleared on the next successful commit, so a malformed
// `[{name:'Alice'}]` (JS literal — invalid JSON) surfaces a red border + 10px
// error line instead of silently reverting to `[]`.
const valueErrors = ref<Map<string, string>>(new Map())

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
  if (type === 'array' || type === 'object') {
    try {
      const parsed = JSON.parse(rawValue)
      const expectedArray = type === 'array'
      if (expectedArray !== Array.isArray(parsed)) {
        valueErrors.value.set(id, `expected a JSON ${type}`)
        return
      }
      valueErrors.value.delete(id)
      commitStates(states.value.map((s) => (s.id === id ? { ...s, defaultValue: parsed } : s)))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      valueErrors.value.set(id, reason)
    }
    return
  }
  valueErrors.value.delete(id)
  commitStates(states.value.map((s) => (s.id === id ? { ...s, defaultValue: parseValue(rawValue, type) } : s)))
}

function defaultFor(type: StateValueType): unknown {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return {}
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
  // Array / object handled inline in `changeDefault` so JSON parse errors
  // can surface a red border + inline reason instead of silently snapping
  // back to `[]` / `{}` — a JS literal like `[{name:'Alice'}]` is invalid
  // JSON and the user needs to see why.
  return raw
}

function defaultAsString(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Phase 1 §7.3 — mirror what the IR collect pass rejects (`collect/state.ts`)
// so invalid entries surface inline instead of silently disappearing from the
// compiled output. Duplicate detection scans in order and flags every
// occurrence past the first.
const nameErrors = computed(() => {
  const errors = new Map<string, string>()
  const seen = new Set<string>()
  for (const s of states.value) {
    const result = validateStateName(s.name)
    if (!result.ok) {
      errors.set(s.id, result.reason ?? 'invalid')
      continue
    }
    if (seen.has(s.name)) {
      errors.set(s.id, `duplicate name "${s.name}"`)
      continue
    }
    seen.add(s.name)
  }
  return errors
})
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
        class="flex flex-col gap-0.5"
      >
        <div class="flex items-center gap-1">
        <input
          :value="state.name"
          :aria-label="panels.lowcodeStateName"
          :aria-invalid="nameErrors.has(state.id) ? 'true' : undefined"
          data-test-id="lowcode-state-name"
          :class="[
            'min-w-0 flex-1 rounded border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent',
            nameErrors.has(state.id) ? 'border-red-500' : 'border-border'
          ]"
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
          :aria-invalid="valueErrors.has(state.id) ? 'true' : undefined"
          data-test-id="lowcode-state-default"
          spellcheck="false"
          :placeholder="
            state.type === 'array'
              ? '[{&quot;name&quot;:&quot;Alice&quot;}]'
              : state.type === 'object'
                ? '{&quot;a&quot;:1}'
                : undefined
          "
          :class="[
            'rounded border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent',
            state.type === 'array' || state.type === 'object'
              ? 'min-w-0 flex-1 font-mono'
              : 'w-20',
            valueErrors.has(state.id) ? 'border-red-500' : 'border-border'
          ]"
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
        </div>
        <p
          v-if="nameErrors.has(state.id)"
          data-test-id="lowcode-state-name-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ nameErrors.get(state.id) }}
        </p>
        <p
          v-if="valueErrors.has(state.id)"
          data-test-id="lowcode-state-default-error"
          class="pl-1 text-[10px] text-red-500"
        >
          {{ valueErrors.get(state.id) }}
        </p>
      </li>
    </ul>
  </div>
</template>
