<script setup lang="ts">
import type {
  LayoutMode,
  LayoutSizing,
  LayoutWrap,
  ResponsiveBreakpoint,
  ResponsiveOverride,
  ResponsiveOverrides
} from '@open-pencil/scene-graph'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'
import { useSectionUI } from '@/components/ui/section'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('responsiveOverrides', () => selectedNode.value?.id)

const BREAKPOINTS: readonly ResponsiveBreakpoint[] = ['sm', 'md', 'lg', 'xl']
const LAYOUT_MODES: readonly LayoutMode[] = ['NONE', 'FREE', 'HORIZONTAL', 'VERTICAL']
const WRAP_MODES: readonly LayoutWrap[] = ['NO_WRAP', 'WRAP']
const SIZING_MODES: readonly LayoutSizing[] = ['FIXED', 'HUG', 'FILL']
const NUMERIC_FIELDS = [
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'width',
  'height',
  'layoutGrow'
] as const

type NumericField = (typeof NUMERIC_FIELDS)[number]

const overrides = useSceneComputed<ResponsiveOverrides>(
  () => selectedNode.value?.responsiveOverrides ?? {}
)

function overrideFor(bp: ResponsiveBreakpoint): ResponsiveOverride {
  return overrides.value[bp] ?? {}
}

function cleanResponsiveOverrides(next: ResponsiveOverrides): ResponsiveOverrides {
  const cleaned: ResponsiveOverrides = {}
  for (const bp of BREAKPOINTS) {
    const value = next[bp]
    if (value && Object.keys(value).length > 0) cleaned[bp] = value
  }
  return cleaned
}

function commit(next: ResponsiveOverrides): void {
  const node = selectedNode.value
  if (!node) return
  editor.updateNodeWithUndo(
    node.id,
    { responsiveOverrides: cleanResponsiveOverrides(next) },
    'Update responsive overrides'
  )
}

function setBreakpointField<K extends keyof ResponsiveOverride>(
  bp: ResponsiveBreakpoint,
  key: K,
  value: ResponsiveOverride[K] | undefined
): void {
  const next: ResponsiveOverrides = { ...overrides.value }
  const current: ResponsiveOverride = { ...next[bp] }
  if (value === undefined) {
    const { [key]: _removed, ...rest } = current
    next[bp] = rest
  } else {
    current[key] = value
    next[bp] = current
  }
  commit(next)
}

function onSelect<K extends keyof ResponsiveOverride>(
  bp: ResponsiveBreakpoint,
  key: K,
  event: Event
): void {
  const raw = (event.target as HTMLSelectElement).value
  setBreakpointField(bp, key, raw === '' ? undefined : (raw as ResponsiveOverride[K]))
}

function onNumber(bp: ResponsiveBreakpoint, key: NumericField, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  setBreakpointField(bp, key, raw === '' ? undefined : Number(raw))
}

function onVisible(bp: ResponsiveBreakpoint, event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  setBreakpointField(bp, 'visible', raw === '' ? undefined : raw === 'true')
}

function clearBreakpoint(bp: ResponsiveBreakpoint): void {
  const { [bp]: _removed, ...next } = overrides.value
  commit(next)
}
</script>

<template>
  <div
    data-test-id="lowcode-responsive"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeResponsive }}</label>

    <div class="flex flex-col gap-2">
      <section
        v-for="bp in BREAKPOINTS"
        :key="bp"
        class="rounded border border-border/70 p-2"
        :data-test-id="`lowcode-responsive-${bp}`"
      >
        <div class="mb-1.5 flex items-center gap-2">
          <span class="font-mono text-[11px] font-semibold text-surface">{{ bp }}</span>
          <button
            type="button"
            class="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
            :data-test-id="`lowcode-responsive-${bp}-clear`"
            :disabled="!overrides[bp]"
            @click="clearBreakpoint(bp)"
          >
            {{ panels.lowcodeResponsiveClear }}
          </button>
        </div>

        <div class="grid grid-cols-2 gap-1.5">
          <label class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] text-muted">{{ panels.lowcodeResponsiveVisible }}</span>
            <select
              :value="overrideFor(bp).visible === undefined ? '' : String(overrideFor(bp).visible)"
              :aria-label="`${bp} ${panels.lowcodeResponsiveVisible}`"
              :data-test-id="`lowcode-responsive-${bp}-visible`"
              class="h-7 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
              @change="onVisible(bp, $event)"
            >
              <option value="">{{ panels.lowcodeResponsiveInherit }}</option>
              <option value="true">{{ panels.lowcodeResponsiveShow }}</option>
              <option value="false">{{ panels.lowcodeResponsiveHide }}</option>
            </select>
          </label>

          <label class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] text-muted">{{ panels.layout }}</span>
            <select
              :value="overrideFor(bp).layoutMode ?? ''"
              :aria-label="`${bp} ${panels.layout}`"
              :data-test-id="`lowcode-responsive-${bp}-layout-mode`"
              class="h-7 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
              @change="onSelect(bp, 'layoutMode', $event)"
            >
              <option value="">{{ panels.lowcodeResponsiveInherit }}</option>
              <option v-for="mode in LAYOUT_MODES" :key="mode" :value="mode">{{ mode }}</option>
            </select>
          </label>

          <label class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] text-muted">{{ panels.lowcodeResponsiveWrap }}</span>
            <select
              :value="overrideFor(bp).layoutWrap ?? ''"
              :aria-label="`${bp} ${panels.lowcodeResponsiveWrap}`"
              :data-test-id="`lowcode-responsive-${bp}-layout-wrap`"
              class="h-7 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
              @change="onSelect(bp, 'layoutWrap', $event)"
            >
              <option value="">{{ panels.lowcodeResponsiveInherit }}</option>
              <option v-for="mode in WRAP_MODES" :key="mode" :value="mode">{{ mode }}</option>
            </select>
          </label>

          <label class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] text-muted">{{ panels.lowcodeResponsiveSizing }}</span>
            <select
              :value="overrideFor(bp).primaryAxisSizing ?? ''"
              :aria-label="`${bp} ${panels.lowcodeResponsiveSizing}`"
              :data-test-id="`lowcode-responsive-${bp}-primary-axis-sizing`"
              class="h-7 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
              @change="onSelect(bp, 'primaryAxisSizing', $event)"
            >
              <option value="">{{ panels.lowcodeResponsiveInherit }}</option>
              <option v-for="mode in SIZING_MODES" :key="mode" :value="mode">{{ mode }}</option>
            </select>
          </label>
        </div>

        <div class="mt-1.5 grid grid-cols-3 gap-1.5">
          <label v-for="field in NUMERIC_FIELDS" :key="field" class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-[10px] text-muted">{{ field }}</span>
            <input
              :value="overrideFor(bp)[field] ?? ''"
              type="number"
              :aria-label="`${bp} ${field}`"
              :data-test-id="`lowcode-responsive-${bp}-${field}`"
              class="h-7 min-w-0 rounded border border-border bg-input px-1.5 text-xs text-surface outline-none focus:border-accent"
              @change="onNumber(bp, field, $event)"
            />
          </label>
        </div>
      </section>
    </div>
  </div>
</template>
