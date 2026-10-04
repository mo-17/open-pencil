import { PDF_VIEWER_MODULE_TYPE, PDF_VIEWER_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter, VueModuleRuntimeOptions } from './types'

export function buildOpenPencilVuePDFViewer(options?: VueModuleRuntimeOptions): string {
  const activation =
    options?.devMode === true
      ? `const authorizedSource = ref('')
watch(() => props.config.sourceUrl, () => { authorizedSource.value = '' }, { flush: 'sync' })
const activeSource = computed(() => authorizedSource.value === props.config.sourceUrl ? props.config.sourceUrl : '')
function activate() { authorizedSource.value = props.config.sourceUrl }`
      : `const activeSource = computed(() => props.config.sourceUrl)`
  const button =
    options?.devMode === true
      ? `<button v-if="config.sourceUrl && !activeSource" data-openpencil-pdf-load="" type="button" :style="{ background: config.accentColor }" style="border:0;border-radius:6px;color:#fff;cursor:pointer;font:600 13px system-ui,sans-serif;padding:10px 14px" @click="activate">Load PDF preview</button>`
      : ''
  return `<script lang="ts">
export interface OpenPencilPdfViewerConfig {
  sourceUrl: string
  title: string
  initialPage: number
  pageCountHint: number
  fit: 'width' | 'page'
  showToolbar: boolean
  allowDownload: boolean
  backgroundColor: string
  accentColor: string
}
</script>
<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, ${options?.devMode === true ? 'ref, watch, ' : ''}useAttrs } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: OpenPencilPdfViewerConfig }>()
const attrs = useAttrs()
const hostStyle = computed(() => {
  const normalized = normalizeStyle([attrs.style])
  const style = normalized && typeof normalized === 'object' ? normalized : {}
  const positioned = normalizeClass(attrs.class).split(' ').some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return positioned || (style?.position && style.position !== 'static') ? style : { ...style, position: 'relative' }
})
${activation}
const src = computed(() => activeSource.value ? activeSource.value + '#page=' + props.config.initialPage + '&view=' + (props.config.fit === 'width' ? 'FitH' : 'Fit') + '&toolbar=' + (props.config.showToolbar ? '1' : '0') : '')
</script>
<template>
  <div v-bind="$attrs" :aria-label="config.title" data-openpencil-pdf-viewer="" role="region" :style="{ ...hostStyle, background: config.backgroundColor }" style="align-items:center;display:flex;flex-direction:column;overflow:hidden">
    <div v-if="config.showToolbar" :style="{ background: config.accentColor }" style="align-items:center;color:#fff;display:flex;flex:0 0 auto;gap:12px;justify-content:space-between;padding:8px 12px;width:100%">
      <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ config.title }}</strong>
      <span style="font:12px system-ui,sans-serif">Page {{ config.initialPage }}{{ config.pageCountHint > 0 ? ' / ' + config.pageCountHint : '' }}</span>
      <a v-if="config.allowDownload && activeSource" :href="activeSource" rel="noopener noreferrer" target="_blank" style="color:#fff">Download</a>
    </div>
    <iframe v-if="src" referrerpolicy="no-referrer" sandbox="" :src="src" :title="config.title" style="border:0;flex:1 1 auto;min-height:0;width:100%" />
    <div v-else style="align-items:center;display:flex;flex:1 1 auto;flex-direction:column;gap:10px;justify-content:center;padding:20px;text-align:center">
      <strong>{{ config.title }}</strong>
      <span style="font:12px system-ui,sans-serif;opacity:.72">{{ config.sourceUrl ? 'Preview loading requires confirmation.' : 'Choose a PDF source in OpenPencil.' }}</span>
      ${button}
    </div>
    <slot />
  </div>
</template>
`
}

export const PDF_VIEWER_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: PDF_VIEWER_PLUGIN_ID,
  moduleType: PDF_VIEWER_MODULE_TYPE,
  componentName: 'OpenPencilPdfViewer',
  runtimePath: 'src/__openpencil_pdf_viewer.vue',
  importPath: '../__openpencil_pdf_viewer.vue',
  buildRuntime: buildOpenPencilVuePDFViewer
})
