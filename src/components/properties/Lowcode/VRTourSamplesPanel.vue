<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'

import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { getActiveEditorStore } from '@/app/editor/active-store'
import { appPluginStore } from '@/app/plugins'
import {
  ensureVRTourSampleAssets,
  VRTourSampleAssetError,
  vrTourSampleAssetErrorMessage
} from '@/app/plugins/vr-tour/assets'
import { vrTourEditorCopy } from '@/app/plugins/vr-tour/copy'
import { applyVRTourSamples } from '@/app/plugins/vr-tour/samples'
import ui from '@/theme/vr-tour-editor'

const { locale } = useI18n()
const { selectedNode } = useSelectionState()
const copy = computed(() => vrTourEditorCopy(locale.value))
const busy = ref(false)
const error = ref('')
const bound = computed(() => Boolean(selectedNode.value?.bindings?.panoramaUrl))
let operation: AbortController | undefined
onScopeDispose(() => operation?.abort())

async function applySamples() {
  if (busy.value || bound.value) return
  const node = selectedNode.value
  if (!node) return
  const editor = getActiveEditorStore()
  const graph = editor.graph
  const id = node.id
  const controller = new AbortController()
  operation = controller
  busy.value = true
  error.value = ''
  try {
    const installed = appPluginStore.module(VR_TOUR_PLUGIN_ID, VR_TOUR_MODULE_TYPE)
    if (installed?.plugin.package.trustSource !== 'app-bundle')
      throw new Error('Plugin unavailable')
    const assets = await ensureVRTourSampleAssets({ signal: controller.signal })
    controller.signal.throwIfAborted()
    const current = appPluginStore.module(VR_TOUR_PLUGIN_ID, VR_TOUR_MODULE_TYPE)
    if (
      getActiveEditorStore() !== editor ||
      editor.graph !== graph ||
      selectedNode.value?.id !== id ||
      current?.plugin.package.trustSource !== 'app-bundle'
    ) {
      error.value = copy.value.samplesChanged
      return
    }
    applyVRTourSamples(editor, id, locale.value, assets)
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value =
        cause instanceof VRTourSampleAssetError
          ? vrTourSampleAssetErrorMessage(cause, locale.value)
          : copy.value.samplesFailed
  } finally {
    busy.value = false
    operation = undefined
  }
}
</script>

<template>
  <div :class="[ui.root, 'mb-3 rounded border border-border p-2']" data-test-id="vr-tour-samples">
    <button type="button" :class="ui.button" :disabled="busy || bound" @click="applySamples">
      {{ busy ? copy.samplesLoading : copy.samples }}
    </button>
    <p :class="ui.hint">{{ bound ? copy.samplesBound : copy.samplesHint }}</p>
    <p :class="ui.hint">{{ copy.samplesCredit }}</p>
    <p v-if="error" role="alert" class="text-xs text-orange-400">{{ error }}</p>
  </div>
</template>
