<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { getNodeEditCapability } from '@open-pencil/core/editor'
import { moduleValueFields } from '@open-pencil/core/plugins'
import { readIcon } from '@open-pencil/scene-graph'
import {
  useComponentProperties,
  useEditorCommands,
  useI18n,
  useSceneComputed,
  useSelectionState
} from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { COMPONENT_TYPES, nodeIcon } from '@/app/editor/icons'
import { openVariablesDialog } from '@/app/editor/tokens/dialog'
import { openLibraryReview, useLibraryService } from '@/app/libraries'
import { editableNodeEvents } from '@/app/lowcode/events/selection'
import { useFormOverviewReveal } from '@/app/lowcode/form-overview/use-reveal'
import {
  designPanelWorkspace,
  getDesignPanelSectionOrder,
  isDesignPanelSectionHidden,
  moveDesignPanelStudioSection,
  resetDesignPanelStudioLayout,
  toggleDesignPanelStudioSection,
  type DesignPanelContext,
  type DesignPanelStudioMoveDirection,
  type DesignPanelWorkspace
} from '@/app/settings/design-panel-workspace'
import IconButton from '@/components/ui/button/IconButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'

import AppearanceSection from './properties/AppearanceSection.vue'
import BehaviourPanel from './properties/component-properties/behaviour/BehaviourPanel.vue'
import ComponentPropertiesSection from './properties/component-properties/ComponentPropertiesSection.vue'
import ComponentPropertyListSection from './properties/component-properties/ComponentPropertyListSection.vue'
import InstanceUpdateAction from './properties/component-properties/instance-update/InstanceUpdateAction.vue'
import SlotAuthoringSection from './properties/component-properties/slot/SlotAuthoringSection.vue'
import VariantAuthoringSection from './properties/component-properties/variant/VariantAuthoringSection.vue'
import ConstraintsSection from './properties/constraints/ConstraintsSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import FramePresetSelect from './properties/frame-presets/FramePresetSelect.vue'
import FramePresetsSection from './properties/frame-presets/FramePresetsSection.vue'
import IconSection from './properties/IconSection.vue'
import InspectorFilter from './properties/InspectorFilter.vue'
import InspectorSection from './properties/InspectorSection.vue'
import InspectorWorkspaceBar from './properties/InspectorWorkspaceBar.vue'
import LayerTypeMenu from './properties/LayerTypeMenu.vue'
import LayoutGridSection from './properties/layout/guides/LayoutGridSection.vue'
import LayoutSection from './properties/layout/LayoutSection.vue'
import AnalyticsConfigPanel from './properties/Lowcode/AnalyticsConfigPanel.vue'
import BackendEditorPanel from './properties/Lowcode/BackendEditorPanel.vue'
import ComponentPropsPanel from './properties/Lowcode/ComponentPropsPanel.vue'
import CustomCodePanel from './properties/Lowcode/CustomCodePanel.vue'
import DocumentStatePanel from './properties/Lowcode/DocumentStatePanel.vue'
import EventsPanel from './properties/Lowcode/EventsPanel.vue'
import FormOverviewPanel from './properties/Lowcode/FormOverviewPanel.vue'
import InteractionStatePanel from './properties/Lowcode/InteractionStatePanel.vue'
import { INTERACTIVE_PROP_FIELDS } from './properties/Lowcode/interactive-fields'
import InteractivePropsPanel from './properties/Lowcode/InteractivePropsPanel.vue'
import LibrariesPanel from './properties/Lowcode/LibrariesPanel.vue'
import ListPanel from './properties/Lowcode/ListPanel.vue'
import ModulePropsPanel from './properties/Lowcode/ModulePropsPanel.vue'
import ModuleValueBindingPanel from './properties/Lowcode/ModuleValueBindingPanel.vue'
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
import RetainedPanel from './properties/panel/RetainedPanel.vue'
import PositionSection from './properties/PositionSection.vue'
import SelectionColorsSection from './properties/selection/SelectionColorsSection.vue'
import SelectionLayoutSection from './properties/selection/SelectionLayoutSection.vue'
import SelectionActionsControl from './properties/SelectionActionsControl.vue'
import StrokeSection from './properties/stroke/StrokeSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariablesSection from './properties/VariablesSection.vue'

interface InspectorWorkspaceBarHandle {
  focusStudioConfig: () => void
}

const inspectorFilter = ref('')
const store = useEditorStore()
const libraryService = useLibraryService()
const activeTool = computed(() => store.state.activeTool)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const {
  setRoot: setSinglePanelRoot,
  isRevealedSection: isFormRevealedSection,
  reveal: revealFormConfiguration
} = useFormOverviewReveal(store, node, multiCount, inspectorFilter)
const { active: componentPropertiesActive } = useComponentProperties()
const showBooleanOperations = computed(() => multiCount.value >= 2)
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  const type = node.value?.type
  return type ? COMPONENT_TYPES.has(type) : false
})
// A library's components are edited in the library, so Add variant has nothing to change here.
const canAddVariant = computed(
  () => !!node.value && getNodeEditCapability(store.graph, node.value.id).editable
)
const selectedIcon = computed(() => (node.value ? nodeIcon(node.value) : undefined))
const hasPrimaryControl = computed(
  () => node.value?.type === 'RADIO' || node.value?.type === 'SELECT'
)
const primaryControlLabel = computed(() =>
  node.value?.type === 'SELECT' ? tools.value.selectField : tools.value.radio
)
const hasModuleValueBinding = computed(
  () => !!node.value && moduleValueFields(node.value).length > 0
)
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
    type === 'CHECKBOX' ||
    type === 'SWITCH' ||
    type === 'SELECT' ||
    type === 'RADIO' ||
    type === 'DATEPICKER' ||
    type === 'FORM'
  )
})
const hasStatePanel = computed(() => {
  const type = node.value?.type
  return type === 'TEXT' || type === 'BUTTON' || type === 'FORM'
})
const hasEvents = computed(() => editableNodeEvents(node.value?.type).length > 0)
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
function openSelectedInstanceReview() {
  const instance = node.value
  if (instance?.type !== 'INSTANCE' || !instance.componentId) return
  const component = store.graph.getNode(instance.componentId)
  const identity = component?.librarySource?.identity
  if (!identity) return
  openLibraryReview({
    libraryId: identity.libraryId,
    assetKey: identity.assetKey,
    instanceIds: [instance.id],
    initialInstanceId: instance.id
  })
}
const isVariantAuthoringNode = computed(() => {
  const selected = node.value
  return Boolean(
    selected &&
    (selected.type === 'COMPONENT_SET' ||
      (selected.type === 'COMPONENT' &&
        selected.parentId &&
        store.graph.getNode(selected.parentId)?.type === 'COMPONENT_SET'))
  )
})
const LAYOUT_GUIDE_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'])
const supportsLayoutGuides = useSceneComputed(() => {
  const nodes = store.getSelectedNodes()
  return nodes.length > 0 && nodes.every((selected) => LAYOUT_GUIDE_TYPES.has(selected.type))
})
const { dialogs, panels, tools } = useI18n()
const focusedShowAll = ref(false)
const workspaceBar = ref<InspectorWorkspaceBarHandle | null>(null)
const panelContext = computed<DesignPanelContext>(() => {
  if (multiCount.value > 1) return 'multi'
  return node.value ? 'single' : 'empty'
})
const panelSectionOrder = computed(() =>
  getDesignPanelSectionOrder(panelContext.value, designPanelWorkspace.value)
)

watch([panelContext, designPanelWorkspace], () => {
  focusedShowAll.value = false
})

function sectionLabel(id: string): string {
  const labels: Record<string, string> = {
    component: 'Component',
    'lowcode-control': primaryControlLabel.value,
    'interaction-states': panels.value.lowcodeInteractionStates,
    module: panels.value.lowcodeModule,
    position: panels.value.position,
    layout: panels.value.layout,
    appearance: panels.value.appearance,
    motion: panels.value.motion,
    export: panels.value.export,
    'lowcode-bindings': 'Bindings',
    'lowcode-events': 'Events',
    'lowcode-validation': 'Validation',
    'lowcode-advanced': 'Advanced',
    page: panels.value.page,
    'lowcode-document-state': panels.value.inspectorSectionLowcodeState,
    'lowcode-document-services': panels.value.inspectorSectionServices,
    'lowcode-document-content': panels.value.inspectorSectionContent,
    'assets-variables': panels.value.inspectorSectionAssets
  }
  return labels[id] ?? id
}

const workspaceSections = computed(() =>
  panelSectionOrder.value.map((id) => ({
    id,
    label: sectionLabel(id),
    visible: !isDesignPanelSectionHidden(panelContext.value, id)
  }))
)

function setWorkspace(workspace: DesignPanelWorkspace): void {
  designPanelWorkspace.value = workspace
}

function workspaceAllowsSection(id: string): boolean {
  if (isFormRevealedSection(id)) return true
  if (hasFilter.value) return true
  if (designPanelWorkspace.value === 'focused' && focusedShowAll.value) return true
  return !isDesignPanelSectionHidden(panelContext.value, id)
}

function sectionVisible(id: string, matches: boolean): boolean {
  return matches && workspaceAllowsSection(id)
}

function sectionStorageScope(): string | undefined {
  return designPanelWorkspace.value === 'classic'
    ? undefined
    : `${designPanelWorkspace.value}:${panelContext.value}`
}

function sectionDefaultOpen(id: string): boolean {
  if (designPanelWorkspace.value === 'classic') return true
  if (panelContext.value === 'empty') return id === 'page'
  if (panelContext.value === 'multi') {
    return id === 'component' || id === 'position' || id === 'appearance'
  }
  return (
    id === 'component' ||
    id === 'lowcode-control' ||
    id === 'position' ||
    id === 'layout' ||
    id === 'appearance'
  )
}

function sectionRenderKey(id: string): string {
  return `${designPanelWorkspace.value}:${panelContext.value}:${id}`
}

function inspectorSectionState(id: string) {
  const hideable =
    designPanelWorkspace.value === 'studio' &&
    !hasFilter.value &&
    !isDesignPanelSectionHidden(panelContext.value, id)
  return {
    storageScope: sectionStorageScope(),
    defaultOpen: sectionDefaultOpen(id),
    forceOpen:
      isFormRevealedSection(id) || (designPanelWorkspace.value !== 'classic' && hasFilter.value),
    hideable,
    hideLabel: dialogs.value.designPanelWorkspaceHideSection({ section: sectionLabel(id) }),
    onHide: () => hideStudioSection(id)
  }
}

async function hideStudioSection(id: string): Promise<void> {
  if (
    designPanelWorkspace.value !== 'studio' ||
    hasFilter.value ||
    isDesignPanelSectionHidden(panelContext.value, id)
  ) {
    return
  }
  toggleDesignPanelStudioSection(panelContext.value, id)
  await nextTick()
  workspaceBar.value?.focusStudioConfig()
}

function moveStudioSection(id: string, direction: DesignPanelStudioMoveDirection): void {
  moveDesignPanelStudioSection(panelContext.value, id, direction)
}

function toggleStudioSection(id: string): void {
  toggleDesignPanelStudioSection(panelContext.value, id)
}

function resetStudioSections(): void {
  resetDesignPanelStudioLayout(panelContext.value)
}

const SECTION_KEYWORDS: Record<string, string[]> = {
  'lowcode-control': [
    'radio',
    'select',
    '下拉',
    'options',
    'default',
    'value',
    'binding',
    '单选',
    '选项',
    '默认',
    '值',
    '绑定'
  ],
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
  module: [
    'module',
    'plugin',
    'map',
    'provider',
    'marker',
    'latitude',
    'longitude',
    'zoom',
    '模块',
    '插件',
    '地图',
    '标记',
    '经度',
    '纬度',
    '缩放',
    'モジュール',
    'プラグイン',
    '地図'
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
const showMultiPosition = computed(
  () =>
    sectionMatches('position', panels.value.position) ||
    sectionMatches('layout', panels.value.layout)
)
const showMultiAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showMultiMotion = computed(() => sectionMatches('motion', panels.value.motion))
const showMultiExport = computed(() => sectionMatches('export', panels.value.export))
const multiHasMatches = computed(
  () =>
    sectionVisible('component', showMultiComponent.value) ||
    sectionVisible('position', showMultiPosition.value) ||
    sectionVisible('appearance', showMultiAppearance.value) ||
    sectionVisible('motion', showMultiMotion.value) ||
    sectionVisible('export', showMultiExport.value)
)

const hasLowcodeBindings = computed(() => {
  const type = node.value?.type
  return (
    !hasPrimaryControl.value &&
    (type === 'TEXT' ||
      type === 'BUTTON' ||
      hasValueBinding.value ||
      hasModuleValueBinding.value ||
      hasStatePanel.value)
  )
})
const showSingleLowcodeControl = computed(
  () => hasPrimaryControl.value && sectionMatches('lowcode-control', primaryControlLabel.value)
)
const showSinglePosition = computed(() => sectionMatches('position', panels.value.position))
const showSingleLayout = computed(() => sectionMatches('layout', panels.value.layout))
const showSingleComponent = computed(
  () => isComponentType.value && sectionMatches('component', 'Component')
)
const showSingleAppearance = computed(() => sectionMatches('appearance', panels.value.appearance))
const showSingleInteractionStates = computed(
  () =>
    hasInteractionStatePanel.value &&
    sectionMatches('interaction-states', panels.value.lowcodeInteractionStates)
)
const hasModulePanel = computed(
  () => node.value?.type === 'FRAME' && node.value.interactiveProps?.module !== undefined
)
const showSingleModule = computed(
  () => hasModulePanel.value && sectionMatches('module', panels.value.lowcodeModule)
)
const showSingleMotion = computed(() => sectionMatches('motion', panels.value.motion))
const showSingleLowcodeBindings = computed(
  () => hasLowcodeBindings.value && sectionMatches('lowcode-bindings', 'Bindings')
)
const showSingleLowcodeEvents = computed(
  () => hasEvents.value && sectionMatches('lowcode-events', 'Events')
)
const showSingleLowcodeValidation = computed(
  () =>
    (hasValidation.value || hasModuleValueBinding.value) &&
    sectionMatches('lowcode-validation', 'Validation')
)
const showSingleLowcodeAdvanced = computed(() => sectionMatches('lowcode-advanced', 'Advanced'))
const showSingleExport = computed(() => sectionMatches('export', panels.value.export))
const singleHasMatches = computed(
  () =>
    sectionVisible('position', showSinglePosition.value) ||
    sectionVisible('layout', showSingleLayout.value) ||
    sectionVisible('component', showSingleComponent.value) ||
    sectionVisible('lowcode-control', showSingleLowcodeControl.value) ||
    sectionVisible('appearance', showSingleAppearance.value) ||
    sectionVisible('interaction-states', showSingleInteractionStates.value) ||
    sectionVisible('module', showSingleModule.value) ||
    sectionVisible('motion', showSingleMotion.value) ||
    sectionVisible('lowcode-bindings', showSingleLowcodeBindings.value) ||
    sectionVisible('lowcode-events', showSingleLowcodeEvents.value) ||
    sectionVisible('lowcode-validation', showSingleLowcodeValidation.value) ||
    sectionVisible('lowcode-advanced', showSingleLowcodeAdvanced.value) ||
    sectionVisible('export', showSingleExport.value)
)

const showEmptyPage = computed(() => sectionMatches('page', panels.value.page))
const showEmptyLowcodeState = computed(() =>
  sectionMatches('lowcode-document-state', panels.value.inspectorSectionLowcodeState)
)
const showEmptyLowcodeServices = computed(() =>
  sectionMatches('lowcode-document-services', panels.value.inspectorSectionServices)
)
const showEmptyLowcodeContent = computed(() =>
  sectionMatches('lowcode-document-content', panels.value.inspectorSectionContent)
)
const showEmptyAssets = computed(() =>
  sectionMatches('assets-variables', panels.value.inspectorSectionAssets)
)
const showEmptyExport = computed(() => sectionMatches('export', panels.value.export))
const emptyHasMatches = computed(
  () =>
    sectionVisible('page', showEmptyPage.value) ||
    sectionVisible('lowcode-document-state', showEmptyLowcodeState.value) ||
    sectionVisible('lowcode-document-services', showEmptyLowcodeServices.value) ||
    sectionVisible('lowcode-document-content', showEmptyLowcodeContent.value) ||
    sectionVisible('assets-variables', showEmptyAssets.value) ||
    sectionVisible('export', showEmptyExport.value)
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
        {{ panels.selectedCount({ count: String(multiCount) }) }}
      </span>
      <template #actions>
        <SelectionActionsControl :show-boolean-operations="showBooleanOperations" />
      </template>
    </PanelHeader>
    <InspectorWorkspaceBar
      ref="workspaceBar"
      :workspace="designPanelWorkspace"
      :context="panelContext"
      :sections="workspaceSections"
      :focused-show-all="focusedShowAll"
      @update:workspace="setWorkspace"
      @update:focused-show-all="focusedShowAll = $event"
      @toggle-section="toggleStudioSection"
      @move-section="moveStudioSection"
      @reset="resetStudioSections"
    />
    <InspectorFilter v-model="inspectorFilter" />
    <template v-for="sectionId in panelSectionOrder" :key="sectionRenderKey(sectionId)">
      <InspectorSection
        v-if="sectionId === 'component'"
        v-show="sectionVisible('component', showMultiComponent)"
        id="component"
        label="Component"
        v-bind="inspectorSectionState('component')"
        :highlighted="sectionHighlighted('component', 'Component')"
      >
        <ComponentPropertiesSection />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'position'"
        v-show="sectionVisible('position', showMultiPosition)"
        id="position"
        :label="panels.position"
        v-bind="inspectorSectionState('position')"
        :highlighted="
          sectionHighlighted('position', panels.position) ||
          sectionHighlighted('layout', panels.layout)
        "
      >
        <PositionSection />
        <ConstraintsSection />
        <SelectionLayoutSection />
        <LayoutGridSection v-if="supportsLayoutGuides" />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'appearance'"
        v-show="sectionVisible('appearance', showMultiAppearance)"
        id="appearance"
        :label="panels.appearance"
        v-bind="inspectorSectionState('appearance')"
        :highlighted="sectionHighlighted('appearance', panels.appearance)"
      >
        <AppearanceSection />
        <TypographySection />
        <FillSection />
        <StrokeSection />
        <EffectsSection />
        <SelectionColorsSection />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'motion'"
        v-show="sectionVisible('motion', showMultiMotion)"
        id="motion"
        :label="panels.motion"
        v-bind="inspectorSectionState('motion')"
        :highlighted="sectionHighlighted('motion', panels.motion)"
      >
        <MotionSection />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'export'"
        v-show="sectionVisible('export', showMultiExport)"
        id="export"
        :label="panels.export"
        v-bind="inspectorSectionState('export')"
        :highlighted="sectionHighlighted('export', panels.export)"
      >
        <ExportSection />
      </InspectorSection>
    </template>
    <div
      v-if="hasFilter && !multiHasMatches"
      data-test-id="inspector-filter-empty"
      class="border-b border-border px-3 py-5 text-center text-xs text-muted"
    >
      {{ panels.inspectorNoMatches }}
    </div>
  </div>

  <!-- Single selection: pause the inspector while inactive. -->
  <RetainedPanel :active="activeTool !== 'FRAME' && multiCount === 1 && !!node">
    <div
      v-if="node"
      :ref="setSinglePanelRoot"
      data-test-id="design-panel-single"
      class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
    >
      <PanelHeader :component="isComponentType">
        <template #icon>
          <LayerTypeMenu
            v-if="node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION'"
            :node="node"
            :icon="selectedIcon"
          />
          <Tip v-else :label="node.type">
            <span role="img" :aria-label="node.type" class="contents">
              <component :is="selectedIcon" class="size-3.5" />
            </span>
          </Tip>
        </template>
        <span role="heading" aria-level="2">{{ node.name }}</span>
        <template #actions>
          <IconButton
            v-if="node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'"
            :label="panels.addVariant"
            data-test-id="add-variant"
            :disabled="!canAddVariant"
            @click="store.addVariant(node.id)"
          >
            <icon-lucide-diamond-plus class="size-3.5" />
          </IconButton>
          <InstanceUpdateAction
            v-if="node.type === 'INSTANCE'"
            :node="node"
            :editor="store"
            :service="libraryService"
            @review="openSelectedInstanceReview"
          />
          <SelectionActionsControl />
        </template>
      </PanelHeader>

      <InspectorWorkspaceBar
        ref="workspaceBar"
        :workspace="designPanelWorkspace"
        :context="panelContext"
        :sections="workspaceSections"
        :focused-show-all="focusedShowAll"
        @update:workspace="setWorkspace"
        @update:focused-show-all="focusedShowAll = $event"
        @toggle-section="toggleStudioSection"
        @move-section="moveStudioSection"
        @reset="resetStudioSections"
      />
      <InspectorFilter v-model="inspectorFilter" />

      <FormOverviewPanel @reveal="revealFormConfiguration" />

      <template v-for="sectionId in panelSectionOrder" :key="sectionRenderKey(sectionId)">
        <InspectorSection
          v-if="sectionId === 'component' && isComponentType"
          v-show="sectionVisible('component', showSingleComponent)"
          id="component"
          label="Component"
          v-bind="inspectorSectionState('component')"
          :highlighted="sectionHighlighted('component', 'Component')"
        >
          <div
            v-if="node.type === 'INSTANCE'"
            class="flex flex-col gap-1 border-b border-border px-3 py-2"
          >
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
              {{ detachInstance.label }}
            </button>
          </div>
          <ComponentPropertiesSection v-if="node.type === 'INSTANCE'" />
          <ComponentPropsPanel v-if="node.type === 'INSTANCE'" />
          <VariantAuthoringSection v-if="isVariantAuthoringNode" />
          <ComponentPropertyListSection />
          <SlotAuthoringSection />
          <BehaviourPanel v-if="node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'lowcode-control'"
          v-show="sectionVisible('lowcode-control', showSingleLowcodeControl)"
          id="lowcode-control"
          :label="primaryControlLabel"
          v-bind="inspectorSectionState('lowcode-control')"
          :highlighted="sectionHighlighted('lowcode-control', primaryControlLabel)"
        >
          <InteractivePropsPanel v-if="hasPrimaryControl" />
          <ValueBindingPanel v-if="hasPrimaryControl" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'interaction-states'"
          v-show="sectionVisible('interaction-states', showSingleInteractionStates)"
          id="interaction-states"
          :label="panels.lowcodeInteractionStates"
          v-bind="inspectorSectionState('interaction-states')"
          :highlighted="sectionHighlighted('interaction-states', panels.lowcodeInteractionStates)"
        >
          <InteractionStatePanel />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'module'"
          v-show="sectionVisible('module', showSingleModule)"
          id="module"
          :label="panels.lowcodeModule"
          v-bind="inspectorSectionState('module')"
          :highlighted="sectionHighlighted('module', panels.lowcodeModule)"
        >
          <ModulePropsPanel />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'position'"
          v-show="sectionVisible('position', showSinglePosition)"
          id="position"
          :label="panels.position"
          v-bind="inspectorSectionState('position')"
          :highlighted="sectionHighlighted('position', panels.position)"
        >
          <IconSection />
          <PositionSection />
          <ConstraintsSection />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'layout'"
          v-show="sectionVisible('layout', showSingleLayout)"
          id="layout"
          :label="panels.layout"
          v-bind="inspectorSectionState('layout')"
          :highlighted="sectionHighlighted('layout', panels.layout)"
        >
          <FramePresetSelect v-if="node.type === 'FRAME' && !readIcon(node)" />
          <LayoutSection />
          <LayoutGridSection v-if="supportsLayoutGuides" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'appearance'"
          v-show="sectionVisible('appearance', showSingleAppearance)"
          id="appearance"
          :label="panels.appearance"
          v-bind="inspectorSectionState('appearance')"
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
          v-else-if="sectionId === 'motion'"
          v-show="sectionVisible('motion', showSingleMotion)"
          id="motion"
          :label="panels.motion"
          v-bind="inspectorSectionState('motion')"
          :highlighted="sectionHighlighted('motion', panels.motion)"
        >
          <MotionSection />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'export'"
          v-show="sectionVisible('export', showSingleExport)"
          id="export"
          :label="panels.export"
          v-bind="inspectorSectionState('export')"
          :highlighted="sectionHighlighted('export', panels.export)"
        >
          <ExportSection />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'lowcode-bindings'"
          v-show="sectionVisible('lowcode-bindings', showSingleLowcodeBindings)"
          id="lowcode-bindings"
          label="Bindings"
          v-bind="inspectorSectionState('lowcode-bindings')"
          :highlighted="sectionHighlighted('lowcode-bindings', 'Bindings')"
        >
          <TextBindingPanel v-if="node.type === 'TEXT' || node.type === 'BUTTON'" />
          <ValueBindingPanel v-if="hasValueBinding && !hasPrimaryControl" />
          <ModuleValueBindingPanel v-if="hasModuleValueBinding" />
          <StatePanel v-if="hasStatePanel" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'lowcode-events'"
          v-show="sectionVisible('lowcode-events', showSingleLowcodeEvents)"
          id="lowcode-events"
          label="Events"
          v-bind="inspectorSectionState('lowcode-events')"
          :highlighted="sectionHighlighted('lowcode-events', 'Events')"
        >
          <EventsPanel v-if="hasEvents" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'lowcode-validation'"
          v-show="sectionVisible('lowcode-validation', showSingleLowcodeValidation)"
          id="lowcode-validation"
          label="Validation"
          v-bind="inspectorSectionState('lowcode-validation')"
          :highlighted="sectionHighlighted('lowcode-validation', 'Validation')"
        >
          <ValidationPanel v-if="hasValidation" />
          <ModuleValueBindingPanel v-if="hasModuleValueBinding" mode="validation" />
        </InspectorSection>

        <InspectorSection
          v-else-if="sectionId === 'lowcode-advanced'"
          v-show="sectionVisible('lowcode-advanced', showSingleLowcodeAdvanced)"
          id="lowcode-advanced"
          label="Advanced"
          v-bind="inspectorSectionState('lowcode-advanced')"
          :highlighted="sectionHighlighted('lowcode-advanced', 'Advanced')"
        >
          <InteractivePropsPanel
            v-if="!hasPrimaryControl && node.type in INTERACTIVE_PROP_FIELDS"
          />
          <ListPanel v-if="node.type === 'LIST'" />
          <RenderConditionPanel />
          <ResponsivePanel />
        </InspectorSection>
      </template>

      <div
        v-if="hasFilter && !singleHasMatches"
        data-test-id="inspector-filter-empty"
        class="border-b border-border px-3 py-5 text-center text-xs text-muted"
      >
        {{ panels.inspectorNoMatches }}
      </div>
    </div>
  </RetainedPanel>

  <div
    v-if="activeTool !== 'FRAME' && multiCount <= 1 && !node"
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <InspectorWorkspaceBar
      ref="workspaceBar"
      :workspace="designPanelWorkspace"
      :context="panelContext"
      :sections="workspaceSections"
      :focused-show-all="focusedShowAll"
      @update:workspace="setWorkspace"
      @update:focused-show-all="focusedShowAll = $event"
      @toggle-section="toggleStudioSection"
      @move-section="moveStudioSection"
      @reset="resetStudioSections"
    />
    <InspectorFilter v-model="inspectorFilter" />
    <template v-for="sectionId in panelSectionOrder" :key="sectionRenderKey(sectionId)">
      <InspectorSection
        v-if="sectionId === 'page'"
        v-show="sectionVisible('page', showEmptyPage)"
        id="page"
        :label="panels.page"
        v-bind="inspectorSectionState('page')"
        :highlighted="sectionHighlighted('page', panels.page)"
      >
        <PageSection />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'lowcode-document-state'"
        v-show="sectionVisible('lowcode-document-state', showEmptyLowcodeState)"
        id="lowcode-document-state"
        :label="panels.inspectorSectionLowcodeState"
        v-bind="inspectorSectionState('lowcode-document-state')"
        :highlighted="
          sectionHighlighted('lowcode-document-state', panels.inspectorSectionLowcodeState)
        "
      >
        <StatePanel />
        <DocumentStatePanel />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'lowcode-document-services'"
        v-show="sectionVisible('lowcode-document-services', showEmptyLowcodeServices)"
        id="lowcode-document-services"
        :label="panels.inspectorSectionServices"
        v-bind="inspectorSectionState('lowcode-document-services')"
        :highlighted="
          sectionHighlighted('lowcode-document-services', panels.inspectorSectionServices)
        "
      >
        <BackendEditorPanel />
        <SupabaseConfigPanel />
        <AnalyticsConfigPanel />
        <CustomCodePanel />
        <WorkflowsPanel />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'lowcode-document-content'"
        v-show="sectionVisible('lowcode-document-content', showEmptyLowcodeContent)"
        id="lowcode-document-content"
        :label="panels.inspectorSectionContent"
        v-bind="inspectorSectionState('lowcode-document-content')"
        :highlighted="
          sectionHighlighted('lowcode-document-content', panels.inspectorSectionContent)
        "
      >
        <TranslationsPanel />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'assets-variables'"
        v-show="sectionVisible('assets-variables', showEmptyAssets)"
        id="assets-variables"
        :label="panels.inspectorSectionAssets"
        v-bind="inspectorSectionState('assets-variables')"
        :highlighted="sectionHighlighted('assets-variables', panels.inspectorSectionAssets)"
      >
        <LibrariesPanel />
        <VariablesSection @open-dialog="openVariablesDialog(store)" />
      </InspectorSection>
      <InspectorSection
        v-else-if="sectionId === 'export'"
        v-show="sectionVisible('export', showEmptyExport)"
        id="export"
        :label="panels.export"
        v-bind="inspectorSectionState('export')"
        :highlighted="sectionHighlighted('export', panels.export)"
      >
        <ExportSection />
      </InspectorSection>
    </template>
    <div
      v-if="hasFilter && !emptyHasMatches"
      data-test-id="inspector-filter-empty"
      class="border-b border-border px-3 py-5 text-center text-xs text-muted"
    >
      {{ panels.inspectorNoMatches }}
    </div>
  </div>
</template>
