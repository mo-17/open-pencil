<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  useComponentProperties,
  useEditorCommands,
  useI18n,
  useSelectionState
} from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { COMPONENT_TYPES, nodeIcon } from '@/app/editor/icons'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'
import Tip from '@/components/ui/Tip.vue'

import VariablesDialog from './variables/VariablesDialog.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import InspectorFilter from './properties/InspectorFilter.vue'
import InspectorSection from './properties/InspectorSection.vue'
import LayoutGridSection from './properties/LayoutSection/LayoutGridSection.vue'
import LayoutSection from './properties/LayoutSection/LayoutSection.vue'
import AnalyticsConfigPanel from './properties/Lowcode/AnalyticsConfigPanel.vue'
import ComponentPropsPanel from './properties/Lowcode/ComponentPropsPanel.vue'
import CustomCodePanel from './properties/Lowcode/CustomCodePanel.vue'
import DocumentStatePanel from './properties/Lowcode/DocumentStatePanel.vue'
import EventsPanel from './properties/Lowcode/EventsPanel.vue'
import InteractionStatePanel from './properties/Lowcode/InteractionStatePanel.vue'
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
import MotionSection from './properties/MotionSectionRoot.vue'
import PageSection from './properties/PageSection.vue'
import ConstraintsSection from './properties/constraints/ConstraintsSection.vue'
import PositionSection from './properties/PositionSection.vue'
import SelectionActionsControl from './properties/SelectionActionsControl.vue'
import StrokeSection from './properties/StrokeSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariablesSection from './properties/VariablesSection.vue'
import ComponentPropertiesSection from './properties/component-properties/ComponentPropertiesSection.vue'
import FramePresetsSection from './properties/frame-presets/FramePresetsSection.vue'
import FramePresetSelect from './properties/frame-presets/FramePresetSelect.vue'

const variablesOpen = ref(false)
const inspectorFilter = ref('')
const store = useEditorStore()
const activeTool = computed(() => store.state.activeTool)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const { active: componentPropertiesActive } = useComponentProperties()
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
const INTERACTION_STATE_NODE_TYPES: ReadonlySet<string> = new Set([
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'CHECKBOX',
  'SWITCH',
  'SELECT',
  'RADIO',
  'DATEPICKER'
])
const hasInteractionStatePanel = computed(() => {
  const selected = node.value
  return Boolean(
    selected &&
    (INTERACTION_STATE_NODE_TYPES.has(selected.type) || selected.stateOverrides !== undefined)
  )
})
const supportsLayoutGuides = computed(() => {
  const type = node.value?.type
  return type === 'FRAME' || type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE'
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
    'size',
    'constraints'
  ],
  layout: [
    'layout',
    'auto layout',
    'grid',
    'layout grid',
    'guide',
    'padding',
    'gap',
    'wrap',
    'clip',
    'spacing',
    'frame preset'
  ],
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
    'mask',
    'typography',
    'font',
    'text',
    'color'
  ],
  'interaction-states': [
    'interaction',
    'state',
    'hover',
    'focus',
    'active',
    'pressed',
    'disabled',
    '悬停',
    '聚焦',
    '按下',
    '禁用'
  ],
  motion: ['motion', 'animation', 'transition', 'keyframe', 'preset', '动效', '动画'],
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
    'analytics',
    'billing',
    'custom code',
    'workflow',
    'events',
    'actions'
  ],
  'lowcode-document-content': ['lowcode', 'document', 'translation', 'i18n', 'locale'],
  'assets-variables': ['assets', 'libraries', 'library', 'variables', 'tokens']
}

const filterNeedle = computed(() => inspectorFilter.value.trim().toLowerCase())
const hasFilter = computed(() => filterNeedle.value.length > 0)

function sectionMatches(id: string, label: string) {
  const needle = filterNeedle.value
  if (!needle) return true
  return [id, label, ...(SECTION_KEYWORDS[id] ?? [])].some((value) =>
    value.toLowerCase().includes(needle)
  )
}

function sectionHighlighted(id: string, label: string) {
  return hasFilter.value && sectionMatches(id, label)
}

const showMultiComponent = computed(
  () => componentPropertiesActive.value && sectionMatches('component', 'Component')
)
const showMultiPosition = computed(() => sectionMatches('position', panels.value.position))
const showMultiAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showMultiMotion = computed(() => sectionMatches('motion', panels.value.motion))
const showMultiExport = computed(() => sectionMatches('export', panels.value.export))
const multiHasMatches = computed(
  () =>
    showMultiComponent.value ||
    showMultiPosition.value ||
    showMultiAppearance.value ||
    showMultiMotion.value ||
    showMultiExport.value
)

const hasLowcodeBindings = computed(() => {
  const type = node.value?.type
  return type === 'TEXT' || type === 'BUTTON' || hasValueBinding.value || hasStatePanel.value
})
const showSinglePosition = computed(() => sectionMatches('position', panels.value.position))
const showSingleLayout = computed(() => sectionMatches('layout', panels.value.layout))
const showSingleComponent = computed(
  () => node.value?.type === 'INSTANCE' && sectionMatches('component', 'Component')
)
const showSingleAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showSingleInteractionStates = computed(
  () =>
    hasInteractionStatePanel.value &&
    sectionMatches('interaction-states', panels.value.lowcodeInteractionStates)
)
const showSingleMotion = computed(() => sectionMatches('motion', panels.value.motion))
const showSingleLowcodeBindings = computed(
  () => hasLowcodeBindings.value && sectionMatches('lowcode-bindings', 'Bindings')
)
const showSingleLowcodeEvents = computed(
  () => hasEvents.value && sectionMatches('lowcode-events', 'Events')
)
const showSingleLowcodeValidation = computed(
  () => hasValidation.value && sectionMatches('lowcode-validation', 'Validation')
)
const showSingleLowcodeAdvanced = computed(() => sectionMatches('lowcode-advanced', 'Advanced'))
const showSingleExport = computed(() => sectionMatches('export', panels.value.export))
const singleHasMatches = computed(
  () =>
    showSinglePosition.value ||
    showSingleLayout.value ||
    showSingleComponent.value ||
    showSingleAppearance.value ||
    showSingleInteractionStates.value ||
    showSingleMotion.value ||
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
  <!-- Frame tool presets replace selection properties, matching Figma. -->
  <div
    v-if="activeTool === 'FRAME'"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <FramePresetsSection />
  </div>

  <!-- Multi-select summary -->
  <div
    v-else-if="multiCount > 1"
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
    <InspectorFilter v-model="inspectorFilter" />
    <InspectorSection
      v-show="showMultiComponent"
      id="component"
      label="Component"
      :highlighted="sectionHighlighted('component', 'Component')"
    >
      <ComponentPropertiesSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiPosition"
      id="position"
      :label="panels.position"
      :highlighted="sectionHighlighted('position', panels.position)"
    >
      <PositionSection />
      <ConstraintsSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiAppearance"
      id="appearance"
      :label="panels.appearance"
      :highlighted="sectionHighlighted('appearance', panels.appearance)"
    >
      <AppearanceSection />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiMotion"
      id="motion"
      :label="panels.motion"
      :highlighted="sectionHighlighted('motion', panels.motion)"
    >
      <MotionSection />
    </InspectorSection>
    <InspectorSection
      v-show="showMultiExport"
      id="export"
      :label="panels.export"
      :highlighted="sectionHighlighted('export', panels.export)"
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

    <InspectorFilter v-model="inspectorFilter" />

    <InspectorSection
      v-if="node.type === 'INSTANCE'"
      v-show="showSingleComponent"
      id="component"
      label="Component"
      :highlighted="sectionHighlighted('component', 'Component')"
    >
      <div class="flex flex-col gap-1 border-b border-border px-3 py-2">
        <button
          type="button"
          data-test-id="design-go-to-component"
          class="rounded bg-component/10 px-2 py-1 text-left text-[11px] text-component hover:bg-component/20"
          @click="goToMainComponent.run()"
        >
          {{ panels.goToMainComponent }}
        </button>
        <button
          type="button"
          data-test-id="design-detach-instance"
          class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover"
          @click="detachInstance.run()"
        >
          {{ panels.detachInstance }}
        </button>
      </div>
      <ComponentPropertiesSection />
      <ComponentPropsPanel />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleInteractionStates"
      id="interaction-states"
      :label="panels.lowcodeInteractionStates"
      :highlighted="sectionHighlighted('interaction-states', panels.lowcodeInteractionStates)"
    >
      <InteractionStatePanel />
    </InspectorSection>

    <InspectorSection
      v-show="showSinglePosition"
      id="position"
      :label="panels.position"
      :highlighted="sectionHighlighted('position', panels.position)"
    >
      <PositionSection />
      <ConstraintsSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLayout"
      id="layout"
      :label="panels.layout"
      :highlighted="sectionHighlighted('layout', panels.layout)"
    >
      <FramePresetSelect v-if="node.type === 'FRAME'" />
      <LayoutSection />
      <LayoutGridSection v-if="supportsLayoutGuides" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleAppearance"
      id="appearance"
      :label="panels.appearance"
      :highlighted="sectionHighlighted('appearance', panels.appearance)"
    >
      <AppearanceSection />
      <MaskSection />
      <TypographySection v-if="node.type === 'TEXT'" />
      <FillSection />
      <StrokeSection />
      <EffectsSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleMotion"
      id="motion"
      :label="panels.motion"
      :highlighted="sectionHighlighted('motion', panels.motion)"
    >
      <MotionSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleExport"
      id="export"
      :label="panels.export"
      :highlighted="sectionHighlighted('export', panels.export)"
    >
      <ExportSection />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeBindings"
      id="lowcode-bindings"
      label="Bindings"
      :highlighted="sectionHighlighted('lowcode-bindings', 'Bindings')"
    >
      <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
      <ValueBindingPanel v-if="hasValueBinding" />
      <StatePanel v-if="hasStatePanel" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeEvents"
      id="lowcode-events"
      label="Events"
      :highlighted="sectionHighlighted('lowcode-events', 'Events')"
    >
      <EventsPanel v-if="hasEvents" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeValidation"
      id="lowcode-validation"
      label="Validation"
      :highlighted="sectionHighlighted('lowcode-validation', 'Validation')"
    >
      <ValidationPanel v-if="hasValidation" />
    </InspectorSection>

    <InspectorSection
      v-show="showSingleLowcodeAdvanced"
      id="lowcode-advanced"
      label="Advanced"
      :highlighted="sectionHighlighted('lowcode-advanced', 'Advanced')"
    >
      <InteractivePropsPanel v-if="node.type in INTERACTIVE_PROP_FIELDS" />
      <ListPanel v-if="node.type === 'LIST'" />
      <RenderConditionPanel />
      <ResponsivePanel />
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
      :label="panels.page"
      :highlighted="sectionHighlighted('page', panels.page)"
    >
      <PageSection />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeState"
      id="lowcode-document-state"
      label="Lowcode State"
      :highlighted="sectionHighlighted('lowcode-document-state', 'Lowcode State')"
    >
      <StatePanel />
      <DocumentStatePanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeServices"
      id="lowcode-document-services"
      label="Services & Workflows"
      :highlighted="sectionHighlighted('lowcode-document-services', 'Services & Workflows')"
    >
      <SupabaseConfigPanel />
      <AnalyticsConfigPanel />
      <CustomCodePanel />
      <WorkflowsPanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyLowcodeContent"
      id="lowcode-document-content"
      label="Content & i18n"
      :highlighted="sectionHighlighted('lowcode-document-content', 'Content & i18n')"
    >
      <TranslationsPanel />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyAssets"
      id="assets-variables"
      label="Assets & Variables"
      :highlighted="sectionHighlighted('assets-variables', 'Assets & Variables')"
    >
      <LibrariesPanel />
      <VariablesSection @open-dialog="variablesOpen = true" />
    </InspectorSection>
    <InspectorSection
      v-show="showEmptyExport"
      id="export"
      :label="panels.export"
      :highlighted="sectionHighlighted('export', panels.export)"
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
