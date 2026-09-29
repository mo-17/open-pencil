<script setup lang="ts">
import {
  CODE_BLOCK_MODULE_LIMITS,
  MARKDOWN_MODULE_LIMITS,
  MODAL_MODULE_LIMITS,
  type DataGridDataV1,
  type DropdownMenuEntryV1,
  type ModulePropertyField,
  type RichTextDocumentV1,
  type SlideMenuItemV1,
  type TableDataV1,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { AccordionEditorCommit } from '@/app/lowcode/accordion-editor'
import type { CarouselSlidesCommit } from '@/app/lowcode/carousel-editor'
import type { ChartDataCommit } from '@/app/lowcode/chart-editor'
import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import type { NavigationEditorCommit } from '@/app/lowcode/navigation-editor'
import type { TabsContentStates, TabsContentRequest } from '@/app/lowcode/tabs-content'
import type { TimelineEditorCommit } from '@/app/lowcode/timeline-editor'
import type { TreeEditorCommit } from '@/app/lowcode/tree-editor'
import type { AppPluginModuleEditorText } from '@/app/plugins/localization'

import DataGridCsvEditor from './DataGridCsvEditor.vue'
import DropdownMenuItemsEditor from './DropdownMenuItemsEditor.vue'
import HtmlContentEditor from './HtmlContentEditor.vue'
import type { SpecializedModuleFieldKind } from './module-property-field'
import { valueAtPath } from './module-props-panel-controller'
import ModuleStructuredFieldEditor from './ModuleStructuredFieldEditor.vue'
import MultilineModuleTextEditor from './MultilineModuleTextEditor.vue'
import RichTextContentEditor from './RichTextContentEditor.vue'
import SlideMenuItemsEditor from './SlideMenuItemsEditor.vue'
import TableContentEditor from './TableContentEditor.vue'
import UploadAcceptEditor from './UploadAcceptEditor.vue'

const structuredKinds = new Set<SpecializedModuleFieldKind>([
  'walktour-steps',
  'org-chart-items',
  'descriptions-items',
  'chart-data',
  'timeline-items',
  'navigation-items',
  'tree-items',
  'carousel-slides',
  'vr-tour-scenes',
  'vr-tour-initial-scene',
  'tabs-items',
  'accordion-items'
])

const {
  field,
  config,
  kind,
  label,
  error,
  moduleEditorText,
  tabsOwner,
  tabsContentStates = {},
  tabsPreviewId,
  contentChildOptions = []
} = defineProps<{
  field: ModulePropertyField
  config: JSONObject
  contentChildOptions?: { value: string; label: string; disabled?: boolean }[]
  kind: SpecializedModuleFieldKind
  label: string
  error?: string
  moduleEditorText: AppPluginModuleEditorText
  tabsOwner?: SceneNode
  tabsContentStates?: TabsContentStates
  tabsPreviewId?: string
}>()

const emit = defineEmits<{
  commit: [value: unknown]
  commitScalar: [request: ModuleScalarCommit]
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

function fieldValue<Value = unknown>(): Value {
  return valueAtPath(config, field.path) as Value
}

function textValue(): string {
  const value = fieldValue()
  return typeof value === 'string' ? value : ''
}

function fieldItems<Item>(): Item[] {
  const value = fieldValue()
  return Array.isArray(value) ? (value as Item[]) : []
}

function uploadAcceptTokens(): string[] {
  const value = fieldValue()
  return Array.isArray(value)
    ? value.filter((token): token is string => typeof token === 'string')
    : []
}
</script>

<template>
  <ModuleStructuredFieldEditor
    v-if="structuredKinds.has(kind)"
    :field="field"
    :config="config"
    :kind="kind"
    :label="label"
    :error="error"
    :module-editor-text="moduleEditorText"
    :tabs-owner="tabsOwner"
    :tabs-content-states="tabsContentStates"
    :tabs-preview-id="tabsPreviewId"
    :content-child-options="contentChildOptions"
    @commit="emit('commit', $event)"
    @commit-scalar="emit('commitScalar', $event)"
    @commit-tabs="emit('commitTabs', $event)"
    @commit-chart-data="emit('commitChartData', $event)"
    @commit-timeline="emit('commitTimeline', $event)"
    @commit-navigation="emit('commitNavigation', $event)"
    @commit-tree="emit('commitTree', $event)"
    @commit-accordion="emit('commitAccordion', $event)"
    @commit-carousel="emit('commitCarousel', $event)"
    @view-tab-content="emit('viewTabContent', $event)"
    @edit-tab-content="emit('editTabContent', $event)"
    @reset-tabs-preview="emit('resetTabsPreview', $event)"
  />
  <RichTextContentEditor
    v-else-if="kind === 'rich-text-content'"
    :model-value="fieldValue<RichTextDocumentV1>()"
    @commit="emit('commit', $event)"
  />

  <HtmlContentEditor
    v-else-if="kind === 'html-content'"
    :model-value="textValue()"
    :label="label"
    :error="error"
    @commit="emit('commit', $event)"
  />

  <TableContentEditor
    v-else-if="kind === 'table-content'"
    :model-value="fieldValue<TableDataV1>()"
    :label="label"
    :error="error"
    @commit="emit('commit', $event)"
  />

  <DataGridCsvEditor
    v-else-if="kind === 'data-grid-data'"
    :model-value="fieldValue<DataGridDataV1>()"
    :label="label"
    @commit="emit('commit', $event)"
  />

  <SlideMenuItemsEditor
    v-else-if="kind === 'slide-menu-items'"
    :model-value="fieldItems<SlideMenuItemV1>()"
    :label="label"
    :invalid="Boolean(error)"
    @commit="emit('commit', $event)"
  />

  <DropdownMenuItemsEditor
    v-else-if="kind === 'dropdown-menu-items'"
    :model-value="fieldItems<DropdownMenuEntryV1>()"
    :label="label"
    :invalid="Boolean(error)"
    @commit="emit('commit', $event)"
  />

  <UploadAcceptEditor
    v-else-if="kind === 'upload-accept'"
    :model-value="uploadAcceptTokens()"
    :label="label"
    :invalid="Boolean(error)"
    @commit="emit('commit', $event)"
  />

  <MultilineModuleTextEditor
    v-else-if="kind === 'modal-content'"
    :owner="tabsOwner"
    :config="config"
    :model-value="textValue()"
    :label="label"
    :max-length="MODAL_MODULE_LIMITS.content"
    :rows="8"
    wrap="soft"
    :error="error"
    @commit="emit('commitScalar', $event)"
  />

  <MultilineModuleTextEditor
    v-else-if="kind === 'markdown-source'"
    :owner="tabsOwner"
    :config="config"
    :model-value="textValue()"
    :label="label"
    :max-length="MARKDOWN_MODULE_LIMITS.source"
    :monospace="false"
    wrap="soft"
    :error="error"
    @commit="emit('commitScalar', $event)"
  />

  <MultilineModuleTextEditor
    v-else-if="kind === 'code-block-code'"
    :owner="tabsOwner"
    :config="config"
    :model-value="textValue()"
    :label="label"
    :max-length="CODE_BLOCK_MODULE_LIMITS.code"
    :rows="12"
    :error="error"
    @commit="emit('commitScalar', $event)"
  />
</template>
