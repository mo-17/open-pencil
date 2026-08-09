<script setup lang="ts">
import {
  CODE_BLOCK_MODULE_LIMITS,
  MARKDOWN_MODULE_LIMITS,
  type AccordionItemV1,
  type DataGridDataV1,
  type ModulePropertyField,
  type RichTextDocumentV1,
  type SlideMenuItemV1,
  type TableDataV1,
  type TabsItemV1
} from '@open-pencil/core/plugins'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import type { AppPluginModuleEditorText } from '@/app/plugins/localization'

import AccordionItemsEditor from './AccordionItemsEditor.vue'
import DataGridCsvEditor from './DataGridCsvEditor.vue'
import HtmlContentEditor from './HtmlContentEditor.vue'
import MultilineModuleTextEditor from './MultilineModuleTextEditor.vue'
import RichTextContentEditor from './RichTextContentEditor.vue'
import SlideMenuItemsEditor from './SlideMenuItemsEditor.vue'
import TableContentEditor from './TableContentEditor.vue'
import TabsItemsEditor from './TabsItemsEditor.vue'
import { valueAtPath } from './module-props-panel-controller'
import type { SpecializedModuleFieldKind } from './module-property-field'

const { field, config, kind, label, error, moduleEditorText } = defineProps<{
  field: ModulePropertyField
  config: JsonObject
  kind: SpecializedModuleFieldKind
  label: string
  error?: string
  moduleEditorText: AppPluginModuleEditorText
}>()

const emit = defineEmits<{
  commit: [value: unknown]
  commitTabs: [value: TabsItemV1[]]
  commitAccordion: [value: AccordionItemV1[]]
}>()

function fieldValue(): unknown {
  return valueAtPath(config, field.path)
}

function textValue(): string {
  const value = fieldValue()
  return typeof value === 'string' ? value : ''
}

function richTextDocument(): RichTextDocumentV1 {
  return fieldValue() as RichTextDocumentV1
}

function tableData(): TableDataV1 {
  return fieldValue() as TableDataV1
}

function dataGridData(): DataGridDataV1 {
  return fieldValue() as DataGridDataV1
}

function slideMenuItems(): SlideMenuItemV1[] {
  const value = fieldValue()
  return Array.isArray(value) ? (value as SlideMenuItemV1[]) : []
}

function tabsItems(): TabsItemV1[] {
  const value = fieldValue()
  return Array.isArray(value) ? (value as TabsItemV1[]) : []
}

function accordionItems(): AccordionItemV1[] {
  const value = fieldValue()
  return Array.isArray(value) ? (value as AccordionItemV1[]) : []
}
</script>

<template>
  <RichTextContentEditor
    v-if="kind === 'rich-text-content'"
    :model-value="richTextDocument()"
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
    :model-value="tableData()"
    :label="label"
    :error="error"
    @commit="emit('commit', $event)"
  />

  <DataGridCsvEditor
    v-else-if="kind === 'data-grid-data'"
    :model-value="dataGridData()"
    :label="label"
    @commit="emit('commit', $event)"
  />

  <SlideMenuItemsEditor
    v-else-if="kind === 'slide-menu-items'"
    :model-value="slideMenuItems()"
    :label="label"
    :invalid="Boolean(error)"
    @commit="emit('commit', $event)"
  />

  <TabsItemsEditor
    v-else-if="kind === 'tabs-items'"
    :model-value="tabsItems()"
    :label="label"
    :add-label="moduleEditorText.addItem"
    :remove-label="moduleEditorText.removeItem"
    :id-label="moduleEditorText.identifier"
    :title-label="moduleEditorText.title"
    :content-label="moduleEditorText.content"
    :new-item-title="moduleEditorText.newTab"
    :count-label="moduleEditorText.count"
    :item-label="moduleEditorText.item"
    :invalid="Boolean(error)"
    :error="error"
    @commit="emit('commitTabs', $event)"
  />

  <AccordionItemsEditor
    v-else-if="kind === 'accordion-items'"
    :model-value="accordionItems()"
    :label="label"
    :add-label="moduleEditorText.addItem"
    :remove-label="moduleEditorText.removeItem"
    :id-label="moduleEditorText.identifier"
    :title-label="moduleEditorText.title"
    :content-label="moduleEditorText.content"
    :new-item-title="moduleEditorText.newSection"
    :count-label="moduleEditorText.count"
    :item-label="moduleEditorText.item"
    :invalid="Boolean(error)"
    :error="error"
    @commit="emit('commitAccordion', $event)"
  />

  <MultilineModuleTextEditor
    v-else-if="kind === 'markdown-source'"
    :model-value="textValue()"
    :label="label"
    :max-length="MARKDOWN_MODULE_LIMITS.source"
    :monospace="false"
    wrap="soft"
    :error="error"
    @commit="emit('commit', $event)"
  />

  <MultilineModuleTextEditor
    v-else-if="kind === 'code-block-code'"
    :model-value="textValue()"
    :label="label"
    :max-length="CODE_BLOCK_MODULE_LIMITS.code"
    :rows="12"
    :error="error"
    @commit="emit('commit', $event)"
  />
</template>
