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
  'lowcode-bindings': [
    'lowcode',
    'binding',
    'state',
    'document state',
    'page state',
    'text',
    'value',
    'controlled',
    'data'
  ],
  'lowcode-events': ['lowcode', 'event', 'events', 'workflow', 'action', 'click', 'submit'],
  'lowcode-validation': ['lowcode', 'validation', 'required', 'rules', 'async', 'form'],
  'lowcode-advanced': [
    'lowcode',
    'advanced',
    'responsive',
    'condition',
    'list',
    'render',
    'props',
    'button',
    'input',
    'options'
  ],
  export: ['export', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf', 'scale'],
  page: ['page', 'canvas', 'background'],
  'lowcode-document-state': ['lowcode', 'document', 'page', 'state', 'data'],
  'lowcode-document-services': [
    'lowcode',
    'document',
    'supabase',
    'database',
    'backend',
    'workflow',
    'events',
    'actions'
  ],
  'lowcode-document-content': ['lowcode', 'document', 'translation', 'i18n', 'locale'],
  'assets-variables': ['assets', 'libraries', 'library', 'variables', 'tokens']
}

const filterNeedle = computed(() => inspectorFilter.value.trim().toLowerCase())
const hasFilter = computed(() => filterNeedle.value.length > 0)

function sectionMatches(id: string, title: string) {
  const needle = filterNeedle.value
  if (!needle) return true
  return [id, title, ...(SECTION_KEYWORDS[id] ?? [])].some((value) =>
    value.toLowerCase().includes(needle)
  )
}

function sectionHighlighted(id: string, title: string) {
  return hasFilter.value && sectionMatches(id, title)
}

const showMultiPosition = computed(() => sectionMatches('position', panels.value.position))
const showMultiAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showMultiExport = computed(() => sectionMatches('export', panels.value.export))
const multiHasMatches = computed(
  () => showMultiPosition.value || showMultiAppearance.value || showMultiExport.value
)

const hasLowcodeBindings = computed(() => {
  const t = node.value?.type
  return t === 'TEXT' || t === 'BUTTON' || hasValueBinding.value || hasStatePanel.value
})
const hasLowcodeValidationGroup = computed(() => hasValidation.value)
const hasLowcodeAdvanced = computed(() => {
  const t = node.value?.type
  return !!t
})
const showSinglePosition = computed(() => sectionMatches('position', panels.value.position))
const showSingleLayout = computed(() => sectionMatches('layout', panels.value.layout))
const showSingleComponent = computed(
  () => node.value?.type === 'INSTANCE' && sectionMatches('component', 'Component')
)
const showSingleAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showSingleLowcodeBindings = computed(
  () => hasLowcodeBindings.value && sectionMatches('lowcode-bindings', 'Bindings')
)
const showSingleLowcodeEvents = computed(
  () => hasEvents.value && sectionMatches('lowcode-events', 'Events')
)
const showSingleLowcodeValidation = computed(
  () => hasLowcodeValidationGroup.value && sectionMatches('lowcode-validation', 'Validation')
)
const showSingleLowcodeAdvanced = computed(
  () => hasLowcodeAdvanced.value && sectionMatches('lowcode-advanced', 'Advanced')
)
const showSingleExport = computed(() => sectionMatches('export', panels.value.export))
const singleHasMatches = computed(
  () =>
    showSinglePosition.value ||
    showSingleLayout.value ||
    showSingleComponent.value ||
    showSingleAppearance.value ||
    showSingleLowcodeBindings.value ||
    showSingleLowcodeEvents.value ||
    showSingleLowcodeValidation.value ||
    showSingleLowcodeAdvanced.value ||
    showSingleExport.value
)

const showEmptyPage = computed(() => sectionMatches('page', panels.value.page))
const showEmptyLowcodeState = computed(() =>
  sectionMatches('lowcode-document-state', 'Lowcode State')
)
const showEmptyLowcodeServices = computed(() =>
  sectionMatches('lowcode-document-services', 'Services & Workflows')
)
const showEmptyLowcodeContent = computed(() =>
  sectionMatches('lowcode-document-content', 'Content & i18n')
)
const showEmptyAssets = computed(() => sectionMatches('assets-variables', 'Assets & Variables'))
const showEmptyExport = computed(() => sectionMatches('export', panels.value.export))
const emptyHasMatches = computed(
  () =>
    showEmptyPage.value ||
    showEmptyLowcodeState.value ||
    showEmptyLowcodeServices.value ||
    showEmptyLowcodeContent.value ||
    showEmptyAssets.value ||
    showEmptyExport.value
)
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
      v-show="showMultiPosition"
      id="position"
      :highlighted="sectionHighlighted('position', panels.position)"
      :title="panels.position"
    >
      <PositionSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiAppearance"
      id="appearance"
      :highlighted="sectionHighlighted('appearance', panels.appearance)"
      :title="panels.appearance"
    >
      <AppearanceSection />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiExport"
      id="export"
      :highlighted="sectionHighlighted('export', panels.export)"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
    <div
      v-if="hasFilter && !multiHasMatches"
      data-test-id="inspector-filter-empty"
      class="border-b border-border px-3 py-5 text-center text-xs text-muted"
    >
      No matching property sections
    </div>
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
      v-show="showSinglePosition"
      id="position"
      :highlighted="sectionHighlighted('position', panels.position)"
      :title="panels.position"
    >
      <PositionSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLayout"
      id="layout"
      :highlighted="sectionHighlighted('layout', panels.layout)"
      :title="panels.layout"
    >
      <LayoutSection />
    </InspectorSection>

    <InspectorSection
      v-if="node.type === 'INSTANCE'"
      v-show="showSingleComponent"
      id="component"
      :highlighted="sectionHighlighted('component', 'Component')"
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
      v-show="showSingleAppearance"
      id="appearance"
      :highlighted="sectionHighlighted('appearance', panels.appearance)"
      :title="panels.appearance"
    >
      <AppearanceSection />
      <TypographySection v-if="node.type === 'TEXT'" />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeBindings"
      id="lowcode-bindings"
      :highlighted="sectionHighlighted('lowcode-bindings', 'Bindings')"
      title="Bindings"
    >
      <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
      <ValueBindingPanel v-if="hasValueBinding" />
      <StatePanel v-if="hasStatePanel" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeEvents"
      id="lowcode-events"
      :highlighted="sectionHighlighted('lowcode-events', 'Events')"
      title="Events"
    >
      <EventsPanel v-if="hasEvents" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeValidation"
      id="lowcode-validation"
      :highlighted="sectionHighlighted('lowcode-validation', 'Validation')"
      title="Validation"
    >
      <ValidationPanel v-if="hasValidation" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeAdvanced"
      id="lowcode-advanced"
      :highlighted="sectionHighlighted('lowcode-advanced', 'Advanced')"
      title="Advanced"
    >
      <InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
      <ListPanel v-if="node.type === 'LIST'" />
      <RenderConditionPanel />
      <ResponsivePanel />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleExport"
      id="export"
      :highlighted="sectionHighlighted('export', panels.export)"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
    <div
      v-if="hasFilter && !singleHasMatches"
      data-test-id="inspector-filter-empty"
      class="border-b border-border px-3 py-5 text-center text-xs text-muted"
    >
      No matching property sections
    </div>
  </div>

  <div
    v-else
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <InspectorFilter v-model="inspectorFilter" />
    <InspectorSection
      v-show="showEmptyPage"
      id="page"
      :highlighted="sectionHighlighted('page', panels.page)"
      :title="panels.page"
    >
      <PageSection />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeState"
      id="lowcode-document-state"
      :highlighted="sectionHighlighted('lowcode-document-state', 'Lowcode State')"
      title="Lowcode State"
    >
      <StatePanel />
      <DocumentStatePanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeServices"
      id="lowcode-document-services"
      :highlighted="sectionHighlighted('lowcode-document-services', 'Services & Workflows')"
      title="Services & Workflows"
    >
      <SupabaseConfigPanel />
      <WorkflowsPanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeContent"
      id="lowcode-document-content"
      :highlighted="sectionHighlighted('lowcode-document-content', 'Content & i18n')"
      title="Content & i18n"
    >
      <TranslationsPanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyAssets"
      id="assets-variables"
      :highlighted="sectionHighlighted('assets-variables', 'Assets & Variables')"
      title="Assets & Variables"
    >
      <LibrariesPanel />
      <VariablesSection @open-dialog="variablesOpen = true" />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyExport"
      id="export"
      :highlighted="sectionHighlighted('export', panels.export)"
      :title="panels.export"
    >
      <ExportSection />
    </InspectorSection>
    <div
      v-if="hasFilter && !emptyHasMatches"
      data-test-id="inspector-filter-empty"
      class="border-b border-border px-3 py-5 text-center text-xs text-muted"
    >
      No matching property sections
    </div>
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
