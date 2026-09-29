<script setup lang="ts">
import { computed } from 'vue'

import { readModuleInstance } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import AppButton from '@/components/ui/button/AppButton.vue'

const { paneId } = defineProps<{ paneId: string }>()
const editor = useEditorStore()
const { panels } = useI18n()
const active = computed(() => editor.activePaneId.value === paneId && editor.state.contentEdit)
const name = computed(() => {
  void editor.state.sceneVersion
  return editor.state.contentEdit ? editor.graph.getNode(editor.state.contentEdit.rootId)?.name : ''
})
const hostPluginId = computed(() => {
  void editor.state.sceneVersion
  const scope = editor.state.contentEdit
  const root = scope && editor.graph.getNode(scope.rootId)
  const host = root?.parentId ? editor.graph.getNode(root.parentId) : undefined
  return readModuleInstance(host?.interactiveProps?.module)?.pluginId
})
const editingLabel = computed(() => {
  if (hostPluginId.value === 'open-pencil.tabs') return panels.value.lowcodeTabsEditingContent
  if (hostPluginId.value === 'open-pencil.popover') return panels.value.lowcodePopoverEditingContent
  return panels.value.lowcodeModalEditingContent
})
const finishLabel = computed(() => {
  if (hostPluginId.value === 'open-pencil.tabs') return panels.value.lowcodeTabsFinishContent
  if (hostPluginId.value === 'open-pencil.popover') return panels.value.lowcodePopoverFinishContent
  return panels.value.lowcodeModalFinishContent
})
</script>

<template>
  <div
    v-if="active"
    data-test-id="content-edit-banner"
    class="flex items-center gap-3 border-b border-border bg-panel px-3 py-2 text-xs text-surface"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium">
        {{ editingLabel }} ·
        {{ name }}
      </p>
      <p class="mt-1 text-[10px] leading-relaxed text-muted">
        {{ panels.lowcodeModalEditingHint }}
      </p>
    </div>
    <AppButton
      variant="outline"
      class="min-h-11 shrink-0"
      data-test-id="modal-finish-content"
      @click="editor.exitContentEdit()"
      >{{ finishLabel }}</AppButton
    >
  </div>
</template>
