<script setup lang="ts">
import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'
import { useI18n } from '@open-pencil/vue'

import { feedbackControlHint } from '@/app/lowcode/feedback-controls/properties'
import { useSectionUI } from '@/components/ui/section'

import { useModulePropsPanelController } from './module-props-panel-controller'
import ModuleDataBindingPanel from './ModuleDataBindingPanel.vue'
import ModulePropertyFieldEditor from './ModulePropertyFieldEditor.vue'
import PaginationBindingPanel from './PaginationBindingPanel.vue'
import StepperBindingPanel from './StepperBindingPanel.vue'
import VRTourSamplesPanel from './VRTourSamplesPanel.vue'

const { locale } = useI18n()
const sectionCls = useSectionUI()
const {
  canCreateContent,
  canOpenContent,
  openContent,
  addContent,
  config,
  contentChildOptions,
  definition,
  fields,
  fieldKey,
  fieldLabel,
  jsonErrors,
  moduleDescription,
  moduleEditorText,
  moduleName,
  optionLabel,
  panels,
  statusMessage,
  commitScalar,
  commitNavigation,
  commitTree,
  commitChart,
  commitTimeline,
  commitAccordionItems,
  commitCarousel,
  commitBooleanField,
  commitField,
  commitJSON,
  commitTabsItems,
  tabsOwner,
  tabsContentStates,
  tabsPreviewId,
  viewTabContent,
  editTabContent,
  resetTabsPreview
} = useModulePropsPanelController()
</script>

<template>
  <div data-test-id="module-props-panel" :class="sectionCls.wrapper">
    <div v-if="definition" class="mb-2">
      <div class="text-[11px] font-medium text-surface">{{ moduleName }}</div>
      <p class="mt-0.5 text-[10px] leading-relaxed text-muted">{{ moduleDescription }}</p>
      <p class="mt-0.5 text-[9px] text-muted/70">
        {{ definition.pluginId }}/{{ definition.moduleType }} ·
        {{ panels.lowcodeModuleConfigVersion({ version: definition.configVersion }) }}
      </p>
    </div>

    <p
      v-if="
        definition?.pluginId === 'open-pencil.slider' ||
        definition?.pluginId === 'open-pencil.rating' ||
        definition?.pluginId === 'open-pencil.date-range'
      "
      data-test-id="module-local-state-hint"
      class="mb-2 text-[10px] leading-relaxed text-muted"
    >
      {{ panels.lowcodeModuleBindingHint }}
    </p>

    <p
      v-if="feedbackControlHint(definition?.pluginId, locale)"
      data-test-id="module-feedback-hint"
      class="mb-2 text-[10px] leading-relaxed text-muted"
    >
      {{ feedbackControlHint(definition?.pluginId, locale) }}
    </p>

    <p
      v-if="statusMessage"
      data-test-id="module-props-status"
      class="mb-2 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-orange-400"
    >
      {{ statusMessage }}
    </p>

    <VRTourSamplesPanel
      v-if="
        definition?.pluginId === VR_TOUR_PLUGIN_ID &&
        definition.moduleType === VR_TOUR_MODULE_TYPE &&
        !statusMessage
      "
    />

    <PaginationBindingPanel v-if="definition?.moduleType === 'pagination' && !statusMessage" />
    <StepperBindingPanel
      v-if="
        definition?.pluginId === 'open-pencil.stepper' &&
        definition.moduleType === 'stepper' &&
        !statusMessage
      "
    />

    <ModuleDataBindingPanel v-if="!statusMessage" />

    <ModulePropertyFieldEditor
      v-for="field in fields"
      :key="fieldKey(field)"
      :field="field"
      :definition="definition"
      :config="config"
      :content-child-options="contentChildOptions"
      :tabs-owner="tabsOwner"
      :tabs-content-states="tabsContentStates"
      :tabs-preview-id="tabsPreviewId"
      @view-tab-content="viewTabContent"
      @edit-tab-content="editTabContent"
      @reset-tabs-preview="resetTabsPreview"
      :can-create-content="canCreateContent"
      :can-open-content="canOpenContent"
      @create-content="addContent"
      @open-content="openContent"
      :label="fieldLabel(field)"
      :error="jsonErrors[fieldKey(field)]"
      :module-editor-text="moduleEditorText"
      :option-label="optionLabel"
      @commit="commitField(field, $event)"
      @commit-scalar="commitScalar(field, $event)"
      @commit-boolean="commitBooleanField(field, $event)"
      @commit-json="commitJSON(field, $event)"
      @commit-tabs="commitTabsItems(field, $event)"
      @commit-accordion="commitAccordionItems"
      @commit-navigation="commitNavigation"
      @commit-tree="commitTree"
      @commit-chart-data="commitChart"
      @commit-timeline="commitTimeline"
      @commit-carousel="commitCarousel"
    />
  </div>
</template>
