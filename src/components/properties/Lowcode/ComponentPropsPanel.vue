<script setup lang="ts">
import { computed } from 'vue'

import { colorToHexRaw, parseColor } from '@open-pencil/core/color'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import AppSelect from '@/components/ui/AppSelect.vue'
import { useSectionUI } from '@/components/ui/section'
import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

const TEXT_PROP_FALLBACK = 'Text'
const FILL_PROP_FALLBACK = 'Fill'

type TextPropRow = {
  id: string
  label: string
  childId: string
  value: string
  masterValue: string
}

type FillPropRow = {
  id: string
  label: string
  childId: string
  value: string
  masterFills: Fill[]
  fillIndex: number
}

const editor = useEditorStore()
const { selectedNode: node } = useSelectionState()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const presence = usePresenceTarget('componentProps', () => node.value?.id)

const instanceComponent = useSceneComputed(() => {
  if (!node.value || node.value.type !== 'INSTANCE' || !node.value.componentId) return null
  return editor.graph.getNode(node.value.componentId) ?? null
})

const componentSetId = computed(() => {
  const comp = instanceComponent.value
  if (!comp) return null
  const parent = comp.parentId ? editor.graph.getNode(comp.parentId) : null
  return parent?.type === 'COMPONENT_SET' ? parent.id : null
})

const variantOptions = useSceneComputed(() => {
  const csId = componentSetId.value
  if (!csId) return new Map<string, Set<string>>()
  return editor.collectVariantOptions(csId)
})

const currentVariantValues = computed(() => {
  return instanceComponent.value?.componentPropertyValues ?? {}
})

const hasVariants = computed(() => variantOptions.value.size > 0)

const textProps = useSceneComputed<TextPropRow[]>(() => {
  const selected = node.value
  if (!selected || selected.type !== 'INSTANCE') return []
  return collectInstanceDescendants(selected.id)
    .filter((child) => child.type === 'TEXT' && !!child.componentId)
    .map((child) => {
      const master = child.componentId ? editor.graph.getNode(child.componentId) : undefined
      return master
        ? {
            id: `${child.id}:text`,
            label: master.name || child.name || TEXT_PROP_FALLBACK,
            childId: child.id,
            value: child.text,
            masterValue: master.text
          }
        : null
    })
    .filter((row): row is TextPropRow => row !== null)
})

const fillProps = useSceneComputed<FillPropRow[]>(() => {
  const selected = node.value
  if (!selected || selected.type !== 'INSTANCE') return []
  return collectInstanceDescendants(selected.id)
    .filter((child) => !!child.componentId)
    .map((child) => {
      const master = child.componentId ? editor.graph.getNode(child.componentId) : undefined
      const fillIndex = firstEditableFillIndex(child, master)
      if (!master || fillIndex === -1) return null
      const fill = child.fills[fillIndex] ?? master.fills[fillIndex]
      return fill?.type === 'SOLID'
        ? {
            id: `${child.id}:fills`,
            label: master.name || child.name || FILL_PROP_FALLBACK,
            childId: child.id,
            value: colorToHexRaw(fill.color),
            masterFills: copyFills(master.fills),
            fillIndex
          }
        : null
    })
    .filter((row): row is FillPropRow => row !== null)
})

const hasProps = computed(
  () => hasVariants.value || textProps.value.length > 0 || fillProps.value.length > 0
)

function collectInstanceDescendants(rootId: string): SceneNode[] {
  const result: SceneNode[] = []
  const visit = (parentId: string) => {
    for (const child of editor.graph.getChildren(parentId)) {
      result.push(child)
      if (child.childIds.length > 0) visit(child.id)
    }
  }
  visit(rootId)
  return result
}

function firstEditableFillIndex(child: SceneNode, master: SceneNode | undefined): number {
  const fills = child.fills.length > 0 ? child.fills : (master?.fills ?? [])
  return fills.findIndex((fill) => fill.type === 'SOLID')
}

function copyFills(fills: Fill[]): Fill[] {
  return fills.map((fill) => ({
    ...fill,
    color: { ...fill.color },
    gradientStops: fill.gradientStops?.map((stop) => ({
      ...stop,
      color: { ...stop.color }
    })),
    gradientTransform: fill.gradientTransform ? { ...fill.gradientTransform } : undefined,
    imageTransform: fill.imageTransform ? { ...fill.imageTransform } : undefined,
    patternSpacing: fill.patternSpacing ? { ...fill.patternSpacing } : undefined,
    noiseSize: fill.noiseSize ? { ...fill.noiseSize } : undefined
  }))
}

function setOverrideMarker(instance: SceneNode, key: string, enabled: boolean): void {
  const next = { ...instance.overrides }
  if (enabled) {
    next[key] = true
  } else {
    const { [key]: _removed, ...rest } = next
    editor.updateNodeWithUndo(instance.id, { overrides: rest }, 'Update component props')
    return
  }
  editor.updateNodeWithUndo(instance.id, { overrides: next }, 'Update component props')
}

function switchVariant(propertyName: string, newValue: string) {
  if (!node.value) return
  editor.switchInstanceVariant(node.value.id, propertyName, newValue)
}

function updateText(row: TextPropRow, event: Event): void {
  const selected = node.value
  if (!selected || selected.type !== 'INSTANCE') return
  const value = (event.target as HTMLInputElement).value
  editor.updateNodeWithUndo(row.childId, { text: value }, 'Update component prop text')
  setOverrideMarker(selected, row.id, value !== row.masterValue)
}

function resetText(row: TextPropRow): void {
  const selected = node.value
  if (!selected || selected.type !== 'INSTANCE') return
  editor.updateNodeWithUndo(row.childId, { text: row.masterValue }, 'Reset component prop text')
  setOverrideMarker(selected, row.id, false)
}

function updateFill(row: FillPropRow, event: Event): void {
  const selected = node.value
  const child = editor.graph.getNode(row.childId)
  if (!selected || selected.type !== 'INSTANCE' || !child) return
  const current = child.fills[row.fillIndex]
  if (!current || current.type !== 'SOLID') return
  const raw = (event.target as HTMLInputElement).value
  const color = parseColor(raw.startsWith('#') ? raw : `#${raw}`)
  const fills = copyFills(child.fills)
  fills[row.fillIndex] = { ...current, color: { ...color, a: current.color.a } }
  editor.updateNodeWithUndo(row.childId, { fills }, 'Update component prop fill')
  setOverrideMarker(selected, row.id, true)
}

function resetFill(row: FillPropRow): void {
  const selected = node.value
  if (!selected || selected.type !== 'INSTANCE') return
  editor.updateNodeWithUndo(
    row.childId,
    { fills: copyFills(row.masterFills) },
    'Reset component prop fill'
  )
  setOverrideMarker(selected, row.id, false)
}
</script>

<template>
  <div
    v-if="hasProps"
    data-test-id="lowcode-component-props"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeComponentProps }}</label>

    <div v-if="hasVariants" data-test-id="variant-section" class="mb-2 flex flex-col gap-1.5">
      <label class="text-[11px] font-medium text-component">{{ panels.variants }}</label>
      <div
        v-for="[propName, options] in variantOptions"
        :key="propName"
        class="flex flex-col gap-0.5"
      >
        <label class="text-[10px] text-muted">{{ propName }}</label>
        <AppSelect
          :model-value="currentVariantValues[propName] ?? ''"
          :label="propName"
          data-test-id="app-select-trigger"
          :options="[...options].map((v) => ({ value: v, label: v }))"
          @update:model-value="switchVariant(propName, $event)"
        />
      </div>
    </div>

    <div v-if="textProps.length > 0" class="mb-2 flex flex-col gap-1.5">
      <label class="text-[10px] uppercase tracking-wide text-muted">{{
        panels.lowcodeComponentPropText
      }}</label>
      <div v-for="row in textProps" :key="row.id" class="flex min-w-0 items-center gap-1.5">
        <label class="w-20 truncate text-[10px] text-muted">{{ row.label }}</label>
        <input
          :value="row.value"
          :aria-label="row.label"
          :data-test-id="`component-prop-text-${row.childId}`"
          class="h-7 min-w-0 flex-1 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
          @change="updateText(row, $event)"
        />
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          :data-test-id="`component-prop-text-reset-${row.childId}`"
          @click="resetText(row)"
        >
          {{ panels.reset }}
        </button>
      </div>
    </div>

    <div v-if="fillProps.length > 0" class="flex flex-col gap-1.5">
      <label class="text-[10px] uppercase tracking-wide text-muted">{{
        panels.lowcodeComponentPropFill
      }}</label>
      <div v-for="row in fillProps" :key="row.id" class="flex min-w-0 items-center gap-1.5">
        <label class="w-20 truncate text-[10px] text-muted">{{ row.label }}</label>
        <input
          :value="`#${row.value}`"
          type="color"
          :aria-label="row.label"
          :data-test-id="`component-prop-fill-${row.childId}`"
          class="h-7 w-10 rounded border border-border bg-input p-0.5 outline-none focus:border-accent"
          @change="updateFill(row, $event)"
        />
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-surface">#{{ row.value }}</span>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          :data-test-id="`component-prop-fill-reset-${row.childId}`"
          @click="resetFill(row)"
        >
          {{ panels.reset }}
        </button>
      </div>
    </div>
  </div>
</template>
