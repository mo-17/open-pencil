<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n, useSelectionState, useEditorCommands } from '@open-pencil/vue'

import VariablesDialog from './VariablesDialog.vue'
import BooleanOperationsControl from './properties/BooleanOperationsControl.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import InspectorFilter from './properties/InspectorFilter.vue'
import InspectorSection from './properties/InspectorSection.vue'
import LayoutSection from './properties/LayoutSection/LayoutSection.vue'
import ComponentPropsPanel from './properties/Lowcode/ComponentPropsPanel.vue'
import DocumentStatePanel from './properties/Lowcode/DocumentStatePanel.vue'
import EventsPanel from './properties/Lowcode/EventsPanel.vue'
import InteractivePropsPanel from './properties/Lowcode/InteractivePropsPanel.vue'
import { INTERACTIVE_PROP_FIELDS } from './properties/Lowcode/interactive-fields'
import LibrariesPanel from './properties/Lowcode/LibrariesPanel.vue'
import ValueBindingPanel from './properties/Lowcode/ValueBindingPanel.vue'
import ValidationPanel from './properties/Lowcode/ValidationPanel.vue'
import ListPanel from './properties/Lowcode/ListPanel.vue'
import RenderConditionPanel from './properties/Lowcode/RenderConditionPanel.vue'
import ResponsivePanel from './properties/Lowcode/ResponsivePanel.vue'
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

const variablesOpen = ref(false)
const inspectorFilter = ref('')
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const showBooleanOperations = computed(() => multiCount.value >= 2)
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  const t = node.value?.type
  return t === 'COMPONENT' || t === 'COMPONENT_SET' || t === 'INSTANCE'
})
const hasValueBinding = computed(() => {
  const t = node.value?.type
  return (
    t === 'INPUT' ||
    t === 'TEXTAREA' ||
    t === 'CHECKBOX' ||
    t === 'SWITCH' ||
    t === 'SELECT' ||
    t === 'RADIO' ||
    t === 'DATEPICKER'
  )
})
const hasValidation = computed(() => {
  const t = node.value?.type
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'DATEPICKER' || t === 'FORM'
})
const hasStatePanel = computed(() => {
  const t = node.value?.type
  return t === 'TEXT' || t === 'BUTTON' || t === 'FORM'
})
const hasEvents = computed(() => {
  const t = node.value?.type
  return t === 'BUTTON' || t === 'FORM'
})
const { panels } = useI18n()

const SECTION_KEYWORDS: Record<string, string[]> = {
  position: [
    'position',
    'x',
    'y',
    'width',
    'height',
    'rotate',
    'rotation',
    'flip',
    'align',
    'size'
  ],
  layout: ['layout', 'auto layout', 'grid', 'padding', 'gap', 'wrap', 'clip', 'spacing'],
  component: ['component', 'instance', 'props', 'property', 'variant', 'detach'],
  appearance: [
    'appearance',
    'fill',
    'stroke',
    'effect',
    'shadow',
    'blur',
    'opacity',
    'radius',
    'typography',
    'font',
    'text',
    'color'
  ],
  lowcode: [
    'lowcode',
    'binding',
    'state',
    'event',
    'workflow',
    'validation',
    'responsive',
    'condition',
    'list',
    'props',
    'button',
    'input'
  ],
  export: ['export', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf', 'scale'],
  page: ['page', 'canvas', 'background'],
  'lowcode-document': [
    'lowcode',
    'document',
    'state',
    'supabase',
    'workflow',
    'translation',
    'i18n'
  ],
  'assets-variables': ['assets', 'libraries', 'library', 'variables', 'tokens']
}

function sectionMatches(id: string, title: string) {
  const needle = inspectorFilter.value.trim().toLowerCase()
  if (!needle) return true
  return [id, title, ...(SECTION_KEYWORDS[id] ?? [])].some((value) =>
    value.toLowerCase().includes(needle)
  )
}
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
    <InspectorFilter v-model="inspectorFilter" />
    <InspectorSection
      v-show="sectionMatches('position', panels.position)"
      id="position"
      :title="panels.position"
    >
      <PositionSection />
    </InspectorSection>
    <InspectorSection
      v-show="sectionMatches('appearance', panels.appearance)"
      id="appearance"
      :title="panels.appearance"
    >
      <AppearanceSection />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>
    <InspectorSection
      v-show="sectionMatches('export', panels.export)"
      id="export"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
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

    <InspectorFilter v-model="inspectorFilter" />

    <InspectorSection
      v-show="sectionMatches('position', panels.position)"
      id="position"
      :title="panels.position"
    >
      <PositionSection />
    </InspectorSection>

    <InspectorSection v-show="sectionMatches('layout', 'Layout')" id="layout" title="Layout">
      <LayoutSection />
    </InspectorSection>

    <InspectorSection
      v-if="node.type === 'INSTANCE'"
      v-show="sectionMatches('component', 'Component')"
      id="component"
      title="Component"
    >
      <div class="flex flex-col gap-1 border-b border-border px-3 py-2">
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
      <ComponentPropsPanel />
    </InspectorSection>

    <InspectorSection
      v-show="sectionMatches('appearance', panels.appearance)"
      id="appearance"
      :title="panels.appearance"
    >
      <AppearanceSection />
      <TypographySection v-if="node.type === 'TEXT'" />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>

    <InspectorSection v-show="sectionMatches('lowcode', 'Lowcode')" id="lowcode" title="Lowcode">
      <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
      <ValueBindingPanel v-if="hasValueBinding" />
      <ValidationPanel v-if="hasValidation" />
      <InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
      <StatePanel v-if="hasStatePanel" />
      <EventsPanel v-if="hasEvents" />
      <ListPanel v-if="node.type === 'LIST'" />
      <ResponsivePanel />
      <RenderConditionPanel />
    </InspectorSection>

    <InspectorSection
      v-show="sectionMatches('export', panels.export)"
      id="export"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
  </div>

  <div
    v-else
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <InspectorFilter v-model="inspectorFilter" />
    <InspectorSection v-show="sectionMatches('page', 'Page')" id="page" title="Page">
      <PageSection />
    </InspectorSection>
    <InspectorSection
      v-show="sectionMatches('lowcode-document', 'Lowcode Document')"
      id="lowcode-document"
      title="Lowcode Document"
    >
      <StatePanel />
      <SupabaseConfigPanel />
      <DocumentStatePanel />
      <WorkflowsPanel />
      <TranslationsPanel />
    </InspectorSection>
    <InspectorSection
      v-show="sectionMatches('assets-variables', 'Assets & Variables')"
      id="assets-variables"
      title="Assets & Variables"
    >
      <LibrariesPanel />
      <VariablesSection @open-dialog="variablesOpen = true" />
    </InspectorSection>
    <InspectorSection
      v-show="sectionMatches('export', panels.export)"
      id="export"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
