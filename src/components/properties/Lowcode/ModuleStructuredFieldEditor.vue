<script setup lang="ts">
import type { ModulePropertyField, TabsItemV1, VRTourSceneV1 } from '@open-pencil/core/plugins'
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

import AccordionItemsEditor from './AccordionItemsEditor.vue'
import CarouselSlidesEditor from './CarouselSlidesEditor.vue'
import ChartDataEditor from './ChartDataEditor.vue'
import DescriptionsItemsEditor from './DescriptionsItemsEditor.vue'
import type { SpecializedModuleFieldKind } from './module-property-field'
import { valueAtPath } from './module-props-panel-controller'
import NavigationItemsEditor from './NavigationItemsEditor.vue'
import OrgChartItemsEditor from './OrgChartItemsEditor.vue'
import TabsItemsEditor from './TabsItemsEditor.vue'
import TimelineItemsEditor from './TimelineItemsEditor.vue'
import TreeItemsEditor from './TreeItemsEditor.vue'
import VRTourScenesEditor from './VRTourScenesEditor.vue'
import WalktourStepsEditor from './WalktourStepsEditor.vue'

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
  kind: SpecializedModuleFieldKind
  label: string
  error?: string
  moduleEditorText: AppPluginModuleEditorText
  tabsOwner?: SceneNode
  tabsContentStates?: TabsContentStates
  tabsPreviewId?: string
  contentChildOptions?: { value: string; label: string; disabled?: boolean }[]
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

function tabItems(): TabsItemV1[] {
  const value = valueAtPath(config, field.path)
  return Array.isArray(value) ? (value as TabsItemV1[]) : []
}

function textValue(): string {
  const value = valueAtPath(config, field.path)
  return typeof value === 'string' ? value : ''
}

function tourScenes(): VRTourSceneV1[] {
  return Array.isArray(config.scenes) ? (config.scenes as VRTourSceneV1[]) : []
}
</script>

<template>
  <WalktourStepsEditor
    v-if="kind === 'walktour-steps'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :targets="contentChildOptions"
    @commit="emit('commitScalar', $event)"
  />
  <OrgChartItemsEditor
    v-else-if="kind === 'org-chart-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    @commit="emit('commitScalar', $event)"
  />
  <DescriptionsItemsEditor
    v-else-if="kind === 'descriptions-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    @commit="emit('commitScalar', $event)"
  />
  <ChartDataEditor
    v-else-if="kind === 'chart-data'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    @commit="emit('commitChartData', $event)"
  />
  <TimelineItemsEditor
    v-else-if="kind === 'timeline-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :label="label"
    :copy="moduleEditorText"
    @commit="emit('commitTimeline', $event)"
  />
  <NavigationItemsEditor
    v-else-if="kind === 'navigation-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :label="label"
    :copy="moduleEditorText"
    @commit="emit('commitNavigation', $event)"
  />
  <TreeItemsEditor
    v-else-if="kind === 'tree-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :label="label"
    @commit="emit('commitTree', $event)"
  />
  <CarouselSlidesEditor
    v-else-if="kind === 'carousel-slides'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :label="label"
    @commit="emit('commitCarousel', $event)"
  />
  <VRTourScenesEditor
    v-else-if="kind === 'vr-tour-scenes'"
    :model-value="tourScenes()"
    :label="label"
    @commit="emit('commit', $event)"
  />
  <select
    v-else-if="kind === 'vr-tour-initial-scene'"
    :value="textValue()"
    :aria-label="label"
    class="h-9 w-full rounded border border-border bg-input px-2 text-xs text-surface outline-none focus:border-accent"
    @change="emit('commit', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="scene in tourScenes()" :key="scene.id" :value="scene.id">
      {{ scene.title }}
    </option>
  </select>
  <TabsItemsEditor
    v-else-if="kind === 'tabs-items'"
    :model-value="tabItems()"
    :label="label"
    :add-label="moduleEditorText.addItem"
    :remove-label="moduleEditorText.removeItem"
    :id-label="moduleEditorText.identifier"
    :title-label="moduleEditorText.title"
    :content-label="moduleEditorText.content"
    :new-item-title="moduleEditorText.newTab"
    :content-child-options="contentChildOptions"
    :content-child-copy="moduleEditorText"
    :canvas="{
      owner: tabsOwner,
      states: tabsContentStates,
      hasPreview: Boolean(tabsPreviewId),
      currentTabId:
        tabsPreviewId || (typeof config.initialTabId === 'string' ? config.initialTabId : undefined)
    }"
    :count-label="moduleEditorText.count"
    :item-label="moduleEditorText.item"
    :invalid="Boolean(error)"
    :error="error"
    @commit="emit('commitTabs', $event)"
    @view-content="emit('viewTabContent', $event)"
    @edit-content="emit('editTabContent', $event)"
    @reset-preview="emit('resetTabsPreview', $event)"
  />
  <AccordionItemsEditor
    v-else-if="kind === 'accordion-items'"
    :key="tabsOwner?.id"
    :owner="tabsOwner"
    :config="config"
    :label="label"
    :copy="moduleEditorText"
    @commit="emit('commitAccordion', $event)"
  />
</template>
