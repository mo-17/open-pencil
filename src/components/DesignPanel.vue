<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n, useSelectionState, useEditorCommands } from '@open-pencil/vue'

import VariablesDialog from './VariablesDialog.vue'
import BooleanOperationsControl from './properties/BooleanOperationsControl.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import LayoutSection from './properties/LayoutSection/LayoutSection.vue'
import DocumentStatePanel from './properties/Lowcode/DocumentStatePanel.vue'
import EventsPanel from './properties/Lowcode/EventsPanel.vue'
import InteractivePropsPanel from './properties/Lowcode/InteractivePropsPanel.vue'
import { INTERACTIVE_PROP_FIELDS } from './properties/Lowcode/interactive-fields'
import ValueBindingPanel from './properties/Lowcode/ValueBindingPanel.vue'
import ListPanel from './properties/Lowcode/ListPanel.vue'
import RenderConditionPanel from './properties/Lowcode/RenderConditionPanel.vue'
import StatePanel from './properties/Lowcode/StatePanel.vue'
import SupabaseConfigPanel from './properties/Lowcode/SupabaseConfigPanel.vue'
import TextBindingPanel from './properties/Lowcode/TextBindingPanel.vue'
import TranslationsPanel from './properties/Lowcode/TranslationsPanel.vue'
import WorkflowsPanel from './properties/Lowcode/WorkflowsPanel.vue'
import PageSection from './properties/PageSection.vue'
import PositionSection from './properties/PositionSection.vue'
import StrokeSection from './properties/StrokeSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariablesSection from './properties/VariablesSection.vue'
import VariantSection from './properties/VariantSection.vue'

const variablesOpen = ref(false)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const showBooleanOperations = computed(() => multiCount.value >= 2)
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  const t = node.value?.type
  return t === 'COMPONENT' || t === 'COMPONENT_SET' || t === 'INSTANCE'
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
    <div
      data-test-id="design-multi-header"
      class="flex items-center gap-1.5 border-b border-border px-3 py-2"
    >
      <span class="text-[11px] text-muted">{{ panels.mixed }}</span>
      <span class="text-xs font-semibold">{{
        panels.layersCount({ count: String(multiCount) })
      }}</span>
      <div class="ml-auto flex items-center">
        <BooleanOperationsControl v-if="showBooleanOperations" />
      </div>
    </div>
    <PositionSection />
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
    <div
      data-test-id="design-node-header"
      class="flex items-center gap-1.5 border-b border-border px-3 py-2"
    >
      <span class="text-[11px]" :class="isComponentType ? 'text-component' : 'text-muted'">{{
        node.type
      }}</span>
      <span class="text-xs font-semibold">{{ node.name }}</span>
    </div>

    <!-- Component actions -->
    <div
      v-if="node.type === 'INSTANCE'"
      class="flex flex-col gap-1 border-b border-border px-3 py-2"
    >
      <button
        data-test-id="design-go-to-component"
        class="rounded bg-component/10 px-2 py-1 text-left text-[11px] text-component hover:bg-component/20"
        @click="goToMainComponent.run()"
      >
        {{ panels.goToMainComponent }}
      </button>
      <button
        data-test-id="design-detach-instance"
        class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover"
        @click="detachInstance.run()"
      >
        {{ panels.detachInstance }}
      </button>
    </div>

    <VariantSection v-if="node.type === 'INSTANCE'" />

    <PositionSection />
    <LayoutSection />
    <AppearanceSection />
    <TypographySection v-if="node.type === 'TEXT'" />
    <FillSection />
    <StrokeSection />
    <EffectsSection />
    <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
    <ValueBindingPanel
      v-if="
        node.type === 'INPUT' ||
        node.type === 'TEXTAREA' ||
        node.type === 'CHECKBOX' ||
        node.type === 'SWITCH' ||
        node.type === 'SELECT' ||
        node.type === 'RADIO' ||
        node.type === 'DATEPICKER'
      "
    />
    <InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
    <StatePanel v-if="node.type === 'TEXT' || node.type === 'BUTTON' || node.type === 'FORM'" />
    <EventsPanel v-if="node.type === 'BUTTON' || node.type === 'FORM'" />
    <ListPanel v-if="node.type === 'LIST'" />
    <RenderConditionPanel />

    <ExportSection />
  </div>

  <div
    v-else
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PageSection />
    <StatePanel />
    <SupabaseConfigPanel />
    <DocumentStatePanel />
    <WorkflowsPanel />
    <TranslationsPanel />
    <VariablesSection @open-dialog="variablesOpen = true" />
    <ExportSection />
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
