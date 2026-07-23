<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n, useSelectionState, useEditorCommands } from '@open-pencil/vue'

import { COMPONENT_TYPES, nodeIcon } from '@/app/editor/icons'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'
import Tip from '@/components/ui/Tip.vue'

import VariablesDialog from './variables/VariablesDialog.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import LayoutSection from './properties/LayoutSection/LayoutSection.vue'
import AnalyticsConfigPanel from './properties/Lowcode/AnalyticsConfigPanel.vue'
import ComponentPropsPanel from './properties/Lowcode/ComponentPropsPanel.vue'
import CustomCodePanel from './properties/Lowcode/CustomCodePanel.vue'
import DocumentStatePanel from './properties/Lowcode/DocumentStatePanel.vue'
import EventsPanel from './properties/Lowcode/EventsPanel.vue'
import InteractivePropsPanel from './properties/Lowcode/InteractivePropsPanel.vue'
import { INTERACTIVE_PROP_FIELDS } from './properties/Lowcode/interactive-fields'
import LibrariesPanel from './properties/Lowcode/LibrariesPanel.vue'
import ListPanel from './properties/Lowcode/ListPanel.vue'
import RenderConditionPanel from './properties/Lowcode/RenderConditionPanel.vue'
import ResponsivePanel from './properties/Lowcode/ResponsivePanel.vue'
import StatePanel from './properties/Lowcode/StatePanel.vue'
import SupabaseConfigPanel from './properties/Lowcode/SupabaseConfigPanel.vue'
import TextBindingPanel from './properties/Lowcode/TextBindingPanel.vue'
import TranslationsPanel from './properties/Lowcode/TranslationsPanel.vue'
import ValidationPanel from './properties/Lowcode/ValidationPanel.vue'
import ValueBindingPanel from './properties/Lowcode/ValueBindingPanel.vue'
import WorkflowsPanel from './properties/Lowcode/WorkflowsPanel.vue'
import MaskSection from './properties/MaskSection.vue'
import PageSection from './properties/PageSection.vue'
import ConstraintsSection from './properties/constraints/ConstraintsSection.vue'
import PositionSection from './properties/PositionSection.vue'
import SelectionActionsControl from './properties/SelectionActionsControl.vue'
import StrokeSection from './properties/StrokeSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariablesSection from './properties/VariablesSection.vue'
import ComponentPropertiesSection from './properties/component-properties/ComponentPropertiesSection.vue'

const variablesOpen = ref(false)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const showBooleanOperations = computed(() => multiCount.value >= 2)
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  const type = node.value?.type
  return type ? COMPONENT_TYPES.has(type) : false
})
const selectedIcon = computed(() => (node.value ? nodeIcon(node.value) : undefined))
const hasValueBinding = computed(() => {
  const type = node.value?.type
  return (
    type === 'INPUT' ||
    type === 'TEXTAREA' ||
    type === 'CHECKBOX' ||
    type === 'SWITCH' ||
    type === 'SELECT' ||
    type === 'RADIO' ||
    type === 'DATEPICKER'
  )
})
const hasValidation = computed(() => {
  const type = node.value?.type
  return (
    type === 'INPUT' ||
    type === 'TEXTAREA' ||
    type === 'SELECT' ||
    type === 'DATEPICKER' ||
    type === 'FORM'
  )
})
const hasStatePanel = computed(() => {
  const type = node.value?.type
  return type === 'TEXT' || type === 'BUTTON' || type === 'FORM'
})
const hasEvents = computed(() => {
  const type = node.value?.type
  return type === 'BUTTON' || type === 'FORM'
})
const { panels } = useI18n()
</script>

<template>
  <!-- Multi-select summary -->
  <div
    v-if="multiCount > 1"
    data-test-id="design-panel-multi"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PanelHeader>
      <template #icon>
        <icon-lucide-layers-3 class="size-3.5" aria-hidden="true" />
      </template>
      <span role="heading" aria-level="2">
        {{ panels.layersCount({ count: String(multiCount) }) }}
      </span>
      <template #actions>
        <SelectionActionsControl :show-boolean-operations="showBooleanOperations" />
      </template>
    </PanelHeader>
    <ComponentPropertiesSection />
    <PositionSection />
    <ConstraintsSection />
    <AppearanceSection />
    <FillSection />
    <StrokeSection />
    <EffectsSection />
    <ExportSection />
  </div>

  <!-- Single selection -->
  <div
    v-else-if="node"
    data-test-id="design-panel-single"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PanelHeader :component="isComponentType">
      <template #icon>
        <Tip :label="node.type">
          <span role="img" :aria-label="node.type" class="contents">
            <component :is="selectedIcon" class="size-3.5" />
          </span>
        </Tip>
      </template>
      <span role="heading" aria-level="2">{{ node.name }}</span>
      <template #actions>
        <SelectionActionsControl />
      </template>
    </PanelHeader>

    <!-- Component actions -->
    <div
      v-if="node.type === 'INSTANCE'"
      class="flex flex-col gap-1 border-b border-border px-3 py-2"
    >
      <button
        type="button"
        class="rounded bg-component/10 px-2 py-1 text-left text-[11px] text-component hover:bg-component/20"
        @click="goToMainComponent.run()"
      >
        {{ panels.goToMainComponent }}
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover"
        @click="detachInstance.run()"
      >
        {{ panels.detachInstance }}
      </button>
    </div>

    <ComponentPropertiesSection v-if="node.type === 'INSTANCE'" />
    <ComponentPropsPanel v-if="node.type === 'INSTANCE'" />

    <PositionSection />
    <ConstraintsSection />
    <LayoutSection />
    <AppearanceSection />
    <MaskSection />
    <TypographySection v-if="node.type === 'TEXT'" />
    <FillSection />
    <StrokeSection />
    <EffectsSection />

    <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
    <ValueBindingPanel v-if="hasValueBinding" />
    <StatePanel v-if="hasStatePanel" />
    <EventsPanel v-if="hasEvents" />
    <ValidationPanel v-if="hasValidation" />
    <InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
    <ListPanel v-if="node.type === 'LIST'" />
    <RenderConditionPanel />
    <ResponsivePanel />

    <ExportSection />
  </div>

  <div
    v-else
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PageSection />
    <StatePanel />
    <DocumentStatePanel />
    <SupabaseConfigPanel />
    <AnalyticsConfigPanel />
    <CustomCodePanel />
    <WorkflowsPanel />
    <TranslationsPanel />
    <LibrariesPanel />
    <VariablesSection @open-dialog="variablesOpen = true" />
    <ExportSection />
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
