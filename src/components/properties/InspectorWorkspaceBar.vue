<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref, type ComponentPublicInstance } from 'vue'

import { useI18n } from '@open-pencil/vue'

import type {
  DesignPanelContext,
  DesignPanelWorkspace
} from '@/app/settings/design-panel-workspace'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { usePopoverUI } from '@/components/ui/popover'

export interface InspectorWorkspaceSection {
  id: string
  label: string
  visible: boolean
}

const { workspace, context, sections, focusedShowAll } = defineProps<{
  workspace: DesignPanelWorkspace
  context: DesignPanelContext
  sections: readonly InspectorWorkspaceSection[]
  focusedShowAll: boolean
}>()

const emit = defineEmits<{
  'update:workspace': [workspace: DesignPanelWorkspace]
  'update:focusedShowAll': [showAll: boolean]
  'toggle-section': [id: string]
  'move-section': [id: string, direction: 'up' | 'down']
  reset: []
}>()

const { dialogs } = useI18n()
const studioOpen = ref(false)
const studioConfigTrigger = ref<HTMLElement | null>(null)
const popover = usePopoverUI({
  content:
    'isolate z-[51] flex max-h-[min(28rem,var(--reka-popover-content-available-height))] w-64 max-w-[calc(100vw-1rem)] flex-col overflow-hidden border border-border'
})

const workspaceOptions = computed<readonly { id: DesignPanelWorkspace; label: string }[]>(() => [
  { id: 'classic', label: dialogs.value.designPanelWorkspaceClassic },
  { id: 'focused', label: dialogs.value.designPanelWorkspaceFocused },
  { id: 'studio', label: dialogs.value.designPanelWorkspaceStudio }
])
const contextLabel = computed(() => {
  const labels: Record<DesignPanelContext, string> = {
    single: dialogs.value.designPanelWorkspaceContextSingle,
    multi: dialogs.value.designPanelWorkspaceContextMulti,
    empty: dialogs.value.designPanelWorkspaceContextEmpty
  }
  return labels[context]
})
const configureSectionsLabel = computed(() =>
  dialogs.value.designPanelWorkspaceConfigureSections({ context: contextLabel.value })
)
const studioPanelDescription = computed(() =>
  dialogs.value.designPanelWorkspaceStudioPanelDescription({ context: contextLabel.value })
)

const showAllModel = computed({
  get: () => focusedShowAll,
  set: (value: boolean) => emit('update:focusedShowAll', value)
})

function selectWorkspace(next: DesignPanelWorkspace): void {
  if (next !== workspace) emit('update:workspace', next)
}

function sectionToggleLabel(section: InspectorWorkspaceSection): string {
  return section.visible
    ? dialogs.value.designPanelWorkspaceHideSection({ section: section.label })
    : dialogs.value.designPanelWorkspaceShowSection({ section: section.label })
}

function sectionMoveLabel(section: InspectorWorkspaceSection, direction: 'up' | 'down'): string {
  return direction === 'up'
    ? dialogs.value.designPanelWorkspaceMoveSectionUp({ section: section.label })
    : dialogs.value.designPanelWorkspaceMoveSectionDown({ section: section.label })
}

function setStudioConfigTrigger(value: Element | ComponentPublicInstance | null): void {
  if (value instanceof Element) {
    studioConfigTrigger.value = value instanceof HTMLElement ? value : null
    return
  }
  const root = value?.$el
  studioConfigTrigger.value = root instanceof HTMLElement ? root : null
}

function focusStudioConfig(): void {
  studioConfigTrigger.value?.focus()
}

defineExpose({ focusStudioConfig })
</script>

<template>
  <div
    data-test-id="design-panel-workspace-bar"
    class="flex min-w-0 flex-col gap-1.5 border-b border-border px-2 py-2"
  >
    <div
      :aria-label="dialogs.designPanelWorkspace"
      class="grid min-w-0 grid-cols-3 rounded bg-input p-0.5"
      role="group"
    >
      <button
        v-for="option in workspaceOptions"
        :key="option.id"
        type="button"
        :aria-pressed="workspace === option.id"
        :data-test-id="`design-panel-workspace-${option.id}`"
        class="min-w-0 truncate rounded px-1 py-1 text-[10px] font-medium text-muted outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent aria-pressed:bg-panel aria-pressed:text-surface aria-pressed:shadow-sm"
        @click="selectWorkspace(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <div
      v-if="workspace === 'focused'"
      class="flex min-w-0 items-center justify-between gap-2 px-1"
    >
      <label class="min-w-0 truncate text-[10px] text-muted" for="design-panel-focused-show-all">
        {{ dialogs.designPanelWorkspaceShowAllSections }}
      </label>
      <AppSwitch
        id="design-panel-focused-show-all"
        v-model="showAllModel"
        data-test-id="design-panel-focused-show-all"
        :label="dialogs.designPanelWorkspaceShowAllSections"
      />
    </div>

    <PopoverRoot v-else-if="workspace === 'studio'" v-model:open="studioOpen">
      <PopoverTrigger
        :ref="setStudioConfigTrigger"
        type="button"
        data-test-id="design-panel-studio-config"
        class="flex h-6 min-w-0 items-center justify-between gap-2 rounded px-1.5 text-[10px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent data-[state=open]:bg-hover data-[state=open]:text-surface"
        :aria-label="configureSectionsLabel"
      >
        <span class="min-w-0 truncate">{{ configureSectionsLabel }}</span>
        <icon-lucide-sliders-horizontal class="size-3 shrink-0" aria-hidden="true" />
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          data-test-id="design-panel-studio-panel"
          side="left"
          align="start"
          :side-offset="8"
          :collision-padding="8"
          :avoid-collisions="true"
          :class="popover.content"
        >
          <div class="border-b border-border px-3 py-2">
            <h3 class="text-[11px] font-semibold text-surface">
              {{ dialogs.designPanelWorkspaceStudioPanelTitle }}
            </h3>
            <p class="mt-0.5 text-[10px] leading-4 text-muted">
              {{ studioPanelDescription }}
            </p>
          </div>

          <ul
            class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1"
            :aria-label="dialogs.designPanelWorkspaceStudioSections"
          >
            <li
              v-for="(section, index) in sections"
              :key="section.id"
              :data-test-id="`design-panel-studio-row-${section.id}`"
              class="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-hover"
            >
              <button
                type="button"
                :aria-label="sectionToggleLabel(section)"
                :aria-pressed="section.visible"
                :data-test-id="`design-panel-studio-row-${section.id}-toggle`"
                class="flex size-6 shrink-0 items-center justify-center rounded text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent aria-pressed:text-accent"
                @click="emit('toggle-section', section.id)"
              >
                <icon-lucide-eye v-if="section.visible" class="size-3" aria-hidden="true" />
                <icon-lucide-eye-off v-else class="size-3" aria-hidden="true" />
              </button>

              <span
                class="min-w-0 flex-1 truncate text-[10px]"
                :class="section.visible ? 'text-surface' : 'text-muted line-through'"
              >
                {{ section.label }}
              </span>

              <button
                type="button"
                :aria-label="sectionMoveLabel(section, 'up')"
                :data-test-id="`design-panel-studio-row-${section.id}-up`"
                :disabled="index === 0"
                class="flex size-6 shrink-0 items-center justify-center rounded text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                @click="emit('move-section', section.id, 'up')"
              >
                <icon-lucide-chevron-up class="size-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                :aria-label="sectionMoveLabel(section, 'down')"
                :data-test-id="`design-panel-studio-row-${section.id}-down`"
                :disabled="index === sections.length - 1"
                class="flex size-6 shrink-0 items-center justify-center rounded text-muted outline-none hover:bg-panel hover:text-surface focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                @click="emit('move-section', section.id, 'down')"
              >
                <icon-lucide-chevron-down class="size-3" aria-hidden="true" />
              </button>
            </li>
          </ul>

          <div class="border-t border-border p-2">
            <button
              type="button"
              data-test-id="design-panel-studio-reset"
              class="flex h-7 w-full items-center justify-center gap-1.5 rounded bg-input px-2 text-[10px] font-medium text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-accent"
              @click="emit('reset')"
            >
              <icon-lucide-rotate-ccw class="size-3" aria-hidden="true" />
              {{ dialogs.designPanelWorkspaceResetStudioLayout }}
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
