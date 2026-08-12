<script setup lang="ts">
import { useSectionUI } from '@/components/ui/section'

import ModulePropertyFieldEditor from './ModulePropertyFieldEditor.vue'
import { useModulePropsPanelController } from './module-props-panel-controller'

const sectionCls = useSectionUI()
const {
  config,
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
  commitAccordionItems,
  commitBooleanField,
  commitField,
  commitJSON,
  commitTabsItems
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
      v-if="statusMessage"
      data-test-id="module-props-status"
      class="mb-2 rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-orange-400"
    >
      {{ statusMessage }}
    </p>

    <ModulePropertyFieldEditor
      v-for="field in fields"
      :key="fieldKey(field)"
      :field="field"
      :definition="definition"
      :config="config"
      :label="fieldLabel(field)"
      :error="jsonErrors[fieldKey(field)]"
      :module-editor-text="moduleEditorText"
      :option-label="optionLabel"
      @commit="commitField(field, $event)"
      @commit-boolean="commitBooleanField(field, $event)"
      @commit-json="commitJSON(field, $event)"
      @commit-tabs="commitTabsItems(field, $event)"
      @commit-accordion="commitAccordionItems(field, $event)"
    />
  </div>
</template>
