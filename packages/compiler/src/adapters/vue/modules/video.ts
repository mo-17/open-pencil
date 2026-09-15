import { VIDEO_DEPENDENCIES, VIDEO_RUNTIME_SOURCE } from '#compiler/adapters/video/source'

import { VIDEO_MODULE_TYPE, VIDEO_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter, VueModuleRuntimeOptions } from './types'

export const VIDEO_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: VIDEO_PLUGIN_ID,
  moduleType: VIDEO_MODULE_TYPE,
  componentName: 'OpenPencilVideo',
  runtimePath: 'src/__openpencil_video.vue',
  importPath: '../__openpencil_video.vue',
  dependencies: VIDEO_DEPENDENCIES,
  optimizeDeps: Object.freeze(Object.keys(VIDEO_DEPENDENCIES)),
  buildRuntime: (
    options?: VueModuleRuntimeOptions
  ) => `<script lang="ts">${VIDEO_RUNTIME_SOURCE}</script>
<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: OpenPencilVideoConfig; videoSrc?: unknown; videoPoster?: unknown; srcBound?: boolean; posterBound?: boolean; lang?: string }>()
const attrs = useAttrs()
const host = ref<HTMLDivElement | null>(null)
const hostStyle = computed(() => {
  const style = normalizeStyle(attrs.style)
  const positioned = normalizeClass(attrs.class).split(' ').some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return positioned || (style?.position && style.position !== 'static') ? style : { ...style, position: 'relative' }
})
let cleanup: (() => void) | undefined
const refresh = () => {
  cleanup?.()
  cleanup = host.value ? mountOpenPencilVideo(host.value, props.config, { src: props.videoSrc, poster: props.videoPoster, srcBound: props.srcBound, posterBound: props.posterBound, preview: ${options?.devMode === true}, lang: props.lang }) : undefined
}
onMounted(refresh)
watch(() => [JSON.stringify(props.config), props.videoSrc, props.videoPoster, props.srcBound, props.posterBound, props.lang], refresh, { flush: 'sync' })
onBeforeUnmount(() => cleanup?.())
</script>
<template><div v-bind="$attrs" :lang="lang" data-openpencil-video="" :style="hostStyle"><div ref="host" style="position:absolute;inset:0" /><slot /></div></template>
`
})
