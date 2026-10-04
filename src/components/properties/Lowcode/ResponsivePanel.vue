<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import {
  RESPONSIVE_BREAKPOINTS,
  type ResponsiveBreakpoint,
  type ResponsiveOverride
} from '@open-pencil/scene-graph'
import {
  useEditorEvent,
  usePanelMessages,
  useSceneComputed,
  useSelectionState
} from '@open-pencil/vue'

import { getActiveEditorStore, useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import {
  requestWebPreviewWidth,
  useWebPreviewWidthRequest
} from '@/app/lowcode/preview-pane/viewport/request'
import {
  RESPONSIVE_PREVIEW_WIDTHS,
  RESPONSIVE_NUMERIC_FIELDS
} from '@/app/lowcode/responsive-editor/model'
import {
  responsiveNodeEditable,
  type ResponsiveEditContext
} from '@/app/lowcode/responsive-editor/use'
import AppButton from '@/components/ui/button/AppButton.vue'
import { useSectionUI } from '@/components/ui/section'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import ResponsiveFields from './ResponsiveFields.vue'

const editor = useEditorStore()
const sectionCls = useSectionUI()
const panels = usePanelMessages()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('responsiveOverrides', () => selectedNode.value?.id)
const breakpoint = ref<ResponsiveBreakpoint>('compact')
const graphEpoch = ref(0)
useEditorEvent('graph:replaced', () => {
  graphEpoch.value++
})
const node = useSceneComputed(() => (selectedNode.value ? { ...selectedNode.value } : undefined))
const graph = useSceneComputed(() => editor.graph)
const editable = useSceneComputed(
  () => !!node.value && responsiveNodeEditable(graph.value, node.value)
)
const fieldsEnabled = ref(true)
const SELECT_KEYS = [
  'visible',
  'layoutMode',
  'layoutWrap',
  'primaryAxisSizing',
  'counterAxisSizing',
  'layoutPositioning',
  'primaryAxisAlign',
  'counterAxisAlign',
  'clipsContent',
  'gridTemplateColumns'
] as const satisfies readonly (keyof ResponsiveOverride)[]
const fieldKey = useSceneComputed(() =>
  JSON.stringify([
    graphEpoch.value,
    node.value?.id,
    breakpoint.value,
    node.value?.responsiveOverrides,
    [...SELECT_KEYS, ...RESPONSIVE_NUMERIC_FIELDS].map((key) => node.value?.[key]),
    editable.value
  ])
)
const context: ResponsiveEditContext = {
  enabled: fieldsEnabled,
  key: () => fieldKey.value,
  cancelDrafts
}
const options = useSceneComputed(() =>
  RESPONSIVE_BREAKPOINTS.map((value) => ({
    value,
    label: `${value} · ${value === 'compact' ? '<1280px' : `≥${RESPONSIVE_PREVIEW_WIDTHS[value]}px`} · ${Object.keys(node.value?.responsiveOverrides?.[value] ?? {}).length}`
  }))
)
const preview = useWebPreviewWidthRequest(getActiveEditorStore)
const requestedSerial = ref(0)
const previewStatus = computed(() => {
  if (!requestedSerial.value || preview.state.value.serial !== requestedSerial.value) return ''
  if (preview.state.value.status === 'applied') return panels.value.lowcodeResponsivePreviewApplied
  if (preview.state.value.status === 'pending') return panels.value.lowcodeResponsivePreviewPending
  if (preview.state.value.status === 'unavailable')
    return panels.value.lowcodeResponsivePreviewUnavailable
  return ''
})
function cancelDrafts() {
  fieldsEnabled.value = false
  void nextTick(() => {
    fieldsEnabled.value = true
  })
}
function previewWidth() {
  cancelDrafts()
  const result = requestWebPreviewWidth(
    getActiveEditorStore(),
    RESPONSIVE_PREVIEW_WIDTHS[breakpoint.value],
    { graph: graph.value, pageId: editor.state.currentPageId }
  )
  requestedSerial.value = result.serial
}
</script>

<template>
  <div
    data-test-id="lowcode-responsive"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">{{ panels.lowcodeResponsive }}</label>
    <p class="mb-2 text-[10px] leading-relaxed text-muted">{{ panels.lowcodeResponsiveHint }}</p>
    <div class="mb-2 space-y-2" @pointerdown.capture="cancelDrafts">
      <AppSelect
        v-model="breakpoint"
        :options="options"
        :label="panels.lowcodeResponsiveBreakpoint"
        data-test-id="lowcode-responsive-breakpoint"
      />
      <div class="flex flex-wrap items-center gap-1">
        <AppButton
          :disabled="preview.available.value === false"
          data-command="preview-responsive-width"
          @click="previewWidth"
          >{{ panels.lowcodeResponsivePreview }} ·
          {{ RESPONSIVE_PREVIEW_WIDTHS[breakpoint] }}px</AppButton
        >
      </div>
      <p v-if="previewStatus" role="status" class="text-[10px] text-muted">{{ previewStatus }}</p>
      <p v-if="preview.available.value === false" class="text-[10px] text-muted">
        {{ panels.lowcodeResponsivePreviewUnavailable }}
      </p>
    </div>
    <p class="mb-2 text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeResponsiveCascadeHint }}
    </p>
    <div class="mb-2 flex items-center gap-1 text-[10px] text-muted">
      <span>{{ panels.lowcodeResponsiveBranchValue }}</span
      ><span class="font-mono">{{ breakpoint }}</span>
    </div>
    <ResponsiveFields
      v-if="node"
      :key="fieldKey"
      :node="node"
      :graph="graph"
      :breakpoint="breakpoint"
      :context="context"
    />
    <p class="mt-3 text-[10px] leading-relaxed text-muted">
      {{ panels.lowcodeResponsivePreviewHint }}
    </p>
  </div>
</template>
