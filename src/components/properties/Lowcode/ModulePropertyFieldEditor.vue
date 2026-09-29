<script setup lang="ts">
import { computed } from 'vue'

import {
  type ModuleDefinition,
  type ModulePropertyField,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useRetainedActivity } from '@open-pencil/vue'

import type { AccordionEditorCommit } from '@/app/lowcode/accordion-editor'
import type { CarouselSlidesCommit } from '@/app/lowcode/carousel-editor'
import type { ChartDataCommit } from '@/app/lowcode/chart-editor'
import { useModuleScalarCommit, type ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import type { NavigationEditorCommit } from '@/app/lowcode/navigation-editor'
import type { TabsContentStates, TabsContentRequest } from '@/app/lowcode/tabs-content'
import type { TimelineEditorCommit } from '@/app/lowcode/timeline-editor'
import type { TreeEditorCommit } from '@/app/lowcode/tree-editor'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'
import AppButton from '@/components/ui/button/AppButton.vue'

import { specializedModuleFieldKind } from './module-property-field'
import { valueAtPath } from './module-props-panel-controller'
import ModuleContentChildSelect from './ModuleContentChildSelect.vue'
import ModuleScalarFieldEditor from './ModuleScalarFieldEditor.vue'
import ModuleSpecializedFieldEditor from './ModuleSpecializedFieldEditor.vue'

const {
  field,
  definition,
  config,
  label,
  error,
  moduleEditorText,
  optionLabel,
  canCreateContent = false,
  canOpenContent = false,
  tabsOwner,
  tabsContentStates = {},
  tabsPreviewId,
  contentChildOptions = []
} = defineProps<{
  canCreateContent?: boolean
  canOpenContent?: boolean
  field: ModulePropertyField
  definition?: ModuleDefinition
  config: JSONObject
  contentChildOptions?: { value: string; label: string; disabled?: boolean }[]
  label: string
  error?: string
  moduleEditorText: AppPluginModuleEditorText
  optionLabel: (field: ModulePropertyField, option: string) => string
  tabsOwner?: SceneNode
  tabsContentStates?: TabsContentStates
  tabsPreviewId?: string
}>()

const emit = defineEmits<{
  createContent: []
  openContent: []
  commitScalar: [request: ModuleScalarCommit]
  commit: [value: unknown]
  commitBoolean: [event: Event]
  commitJson: [source: string]
  commitTabs: [value: TabsItemV1[]]
  commitChartData: [request: ChartDataCommit]
  commitTimeline: [request: TimelineEditorCommit]
  commitNavigation: [request: NavigationEditorCommit]
  commitTree: [request: TreeEditorCommit]
  commitAccordion: [request: AccordionEditorCommit]
  commitCarousel: [request: CarouselSlidesCommit]
  viewTabContent: [request: TabsContentRequest]
  editTabContent: [request: TabsContentRequest]
  resetTabsPreview: [owner: SceneNode | undefined]
}>()

const specializedKind = computed(() => specializedModuleFieldKind(definition, field))
const { panels } = useI18n()
const active = useRetainedActivity()
const {
  ownerGeneration,
  beginInput: beginScalarInput,
  submit
} = useModuleScalarCommit(
  () => tabsOwner,
  () => config,
  (request) => emit('commitScalar', request),
  active
)

function beginInput(event: Event): void {
  const generation = (event.currentTarget as HTMLElement).dataset.scalarGeneration
  if (generation !== undefined) beginScalarInput(Number(generation))
}

function textValue(): string {
  const value = valueAtPath(config, field.path)
  return typeof value === 'string' ? value : ''
}
</script>

<template>
  <div
    data-test-id="module-property-field"
    :data-scalar-generation="ownerGeneration"
    :data-module-path="field.path.map(String).join('.')"
    class="mb-2 flex flex-col gap-1"
    @focusin="beginInput"
    @pointerdown.capture="beginInput"
    @keydown.capture="beginInput"
  >
    <label v-if="specializedKind" class="text-[10px] text-muted">{{ label }}</label>
    <template
      v-if="
        (definition?.pluginId === 'open-pencil.modal' ||
          definition?.pluginId === 'open-pencil.popover') &&
        field.path[0] === 'contentChildName'
      "
    >
      <label class="text-[10px] text-muted">{{ label }}</label>
      <ModuleContentChildSelect
        :model-value="textValue()"
        :options="contentChildOptions"
        :copy="moduleEditorText"
        @commit="emit('commit', $event)"
      />
      <div class="flex flex-wrap gap-2">
        <AppButton
          variant="outline"
          class="min-h-11"
          :disabled="!canOpenContent"
          data-test-id="modal-edit-content"
          @click="emit('openContent')"
          >{{ panels.lowcodeModalEditContent }}</AppButton
        >
        <AppButton
          variant="outline"
          class="min-h-11"
          :disabled="!canCreateContent"
          data-test-id="modal-create-content"
          @click="emit('createContent')"
          >{{ panels.lowcodeModalCreateContent }}</AppButton
        >
      </div>
      <p class="text-[10px] leading-relaxed text-muted">{{ panels.lowcodeModalContentHint }}</p>
    </template>
    <ModuleSpecializedFieldEditor
      v-else-if="specializedKind"
      :field="field"
      :config="config"
      :kind="specializedKind"
      :label="label"
      :error="error"
      :module-editor-text="moduleEditorText"
      :content-child-options="contentChildOptions"
      :tabs-owner="tabsOwner"
      :tabs-content-states="tabsContentStates"
      :tabs-preview-id="tabsPreviewId"
      @view-tab-content="emit('viewTabContent', $event)"
      @edit-tab-content="emit('editTabContent', $event)"
      @reset-tabs-preview="emit('resetTabsPreview', $event)"
      @commit="emit('commit', $event)"
      @commit-scalar="emit('commitScalar', $event)"
      @commit-tabs="emit('commitTabs', $event)"
      @commit-accordion="emit('commitAccordion', $event)"
      @commit-chart-data="emit('commitChartData', $event)"
      @commit-timeline="emit('commitTimeline', $event)"
      @commit-navigation="emit('commitNavigation', $event)"
      @commit-tree="emit('commitTree', $event)"
      @commit-carousel="emit('commitCarousel', $event)"
    />

    <ModuleScalarFieldEditor
      v-else
      :key="ownerGeneration"
      :field="field"
      :definition="definition"
      :config="config"
      :label="label"
      :option-label="optionLabel"
      @commit="submit({ kind: 'value', value: $event })"
      @commit-boolean="submit({ kind: 'boolean', event: $event })"
      @commit-json="submit({ kind: 'json', source: $event })"
    />
    <p v-if="error" class="text-[10px] text-red-400">{{ error }}</p>
  </div>
</template>
