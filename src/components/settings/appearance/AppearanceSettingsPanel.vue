<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import {
  designPanelWorkspace,
  type DesignPanelWorkspace
} from '@/app/settings/design-panel-workspace'
import {
  previewToolbarLayout,
  type PreviewToolbarLayout
} from '@/app/settings/preview-toolbar-layout'

const { dialogs } = useI18n()

const workspaceOptions = computed<
  Array<{ value: DesignPanelWorkspace; label: string; hint: string }>
>(() => [
  {
    value: 'classic',
    label: dialogs.value.designPanelWorkspaceClassic,
    hint: dialogs.value.designPanelWorkspaceClassicHint
  },
  {
    value: 'focused',
    label: dialogs.value.designPanelWorkspaceFocused,
    hint: dialogs.value.designPanelWorkspaceFocusedHint
  },
  {
    value: 'studio',
    label: dialogs.value.designPanelWorkspaceStudio,
    hint: dialogs.value.designPanelWorkspaceStudioHint
  }
])

const toolbarOptions = computed<
  Array<{ value: PreviewToolbarLayout; label: string; hint: string; density: number }>
>(() => [
  {
    value: 'adaptive',
    label: dialogs.value.previewToolbarLayoutAdaptive,
    hint: dialogs.value.previewToolbarLayoutAdaptiveHint,
    density: 5
  },
  {
    value: 'compact',
    label: dialogs.value.previewToolbarLayoutCompact,
    hint: dialogs.value.previewToolbarLayoutCompactHint,
    density: 4
  },
  {
    value: 'classic',
    label: dialogs.value.previewToolbarLayoutClassic,
    hint: dialogs.value.previewToolbarLayoutClassicHint,
    density: 8
  }
])
</script>

<template>
  <section class="flex flex-col gap-4" data-test-id="settings-appearance-panel">
    <div>
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsAppearance }}</h3>
      <p class="mt-0.5 text-[10px] text-muted">
        {{ dialogs.designPanelWorkspaceDescription }}
      </p>
    </div>

    <fieldset class="grid gap-2" data-test-id="settings-design-panel-workspace">
      <legend class="mb-1 text-[10px] font-medium text-surface">
        {{ dialogs.designPanelWorkspace }}
      </legend>

      <label
        v-for="option in workspaceOptions"
        :key="option.value"
        class="group grid cursor-pointer grid-cols-[7.5rem_minmax(0,1fr)] gap-3 rounded-lg border bg-input/30 p-2.5 outline-none transition-colors hover:bg-hover/60 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent"
        :class="
          designPanelWorkspace === option.value ? 'border-accent/70 bg-accent/5' : 'border-border'
        "
        :data-selected="designPanelWorkspace === option.value || undefined"
        :data-test-id="`settings-design-panel-workspace-${option.value}`"
      >
        <input
          v-model="designPanelWorkspace"
          class="sr-only"
          type="radio"
          name="design-panel-workspace"
          :value="option.value"
        />

        <span
          class="flex h-14 overflow-hidden rounded border border-border bg-panel p-1.5"
          aria-hidden="true"
        >
          <span class="mr-1.5 w-5 shrink-0 rounded-sm bg-muted/15" />
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span
              v-for="index in option.value === 'focused' ? 3 : 5"
              :key="index"
              class="rounded-sm border border-border/80 bg-muted/15"
              :class="[
                option.value === 'studio' && index === 2 ? 'order-first' : '',
                option.value === 'focused' ? 'h-3' : 'h-2'
              ]"
            />
          </span>
        </span>

        <span class="min-w-0 self-center">
          <span class="flex items-center gap-1.5 text-xs font-medium text-surface">
            {{ option.label }}
            <span
              v-if="option.value === 'studio'"
              class="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent"
            >
              {{ dialogs.designPanelWorkspaceRecommended }}
            </span>
          </span>
          <span class="mt-1 block text-[10px] leading-relaxed text-muted">{{ option.hint }}</span>
        </span>
      </label>
    </fieldset>

    <fieldset class="grid gap-2" data-test-id="settings-preview-toolbar-layout">
      <legend class="mb-1 text-[10px] font-medium text-surface">
        {{ dialogs.previewToolbarLayout }}
      </legend>
      <p class="-mt-1 mb-1 text-[10px] text-muted">
        {{ dialogs.previewToolbarLayoutDescription }}
      </p>

      <label
        v-for="option in toolbarOptions"
        :key="option.value"
        class="group grid cursor-pointer grid-cols-[7.5rem_minmax(0,1fr)] gap-3 rounded-lg border bg-input/30 p-2.5 outline-none transition-colors hover:bg-hover/60 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent"
        :class="
          previewToolbarLayout === option.value ? 'border-accent/70 bg-accent/5' : 'border-border'
        "
        :data-selected="previewToolbarLayout === option.value || undefined"
        :data-test-id="`settings-preview-toolbar-layout-${option.value}`"
      >
        <input
          v-model="previewToolbarLayout"
          class="sr-only"
          type="radio"
          name="preview-toolbar-layout"
          :value="option.value"
        />

        <span
          class="flex h-14 items-start gap-1 overflow-hidden rounded border border-border bg-panel p-1.5"
          aria-hidden="true"
        >
          <span class="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span class="mt-0.5 h-2 w-6 shrink-0 rounded-sm bg-muted/35" />
          <span
            v-for="index in option.density"
            :key="index"
            class="mt-0.5 h-2 shrink-0 rounded-sm bg-muted/25"
            :class="option.value === 'classic' ? 'w-3' : index === 2 ? 'w-6' : 'w-4'"
          />
        </span>

        <span class="min-w-0 self-center">
          <span class="flex items-center gap-1.5 text-xs font-medium text-surface">
            {{ option.label }}
            <span
              v-if="option.value === 'adaptive'"
              class="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent"
            >
              {{ dialogs.previewToolbarLayoutRecommended }}
            </span>
          </span>
          <span class="mt-1 block text-[10px] leading-relaxed text-muted">{{ option.hint }}</span>
        </span>
      </label>
    </fieldset>
  </section>
</template>
