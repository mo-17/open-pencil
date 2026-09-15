import { VR_TOUR_DEPENDENCIES, VR_TOUR_RUNTIME_SOURCE } from '#compiler/adapters/vr-tour/source'

import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter } from './types'

export const VR_TOUR_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: VR_TOUR_PLUGIN_ID,
  moduleType: VR_TOUR_MODULE_TYPE,
  componentName: 'OpenPencilVRTour',
  runtimePath: 'src/__openpencil_vr_tour.vue',
  importPath: '../__openpencil_vr_tour.vue',
  dependencies: VR_TOUR_DEPENDENCIES,
  optimizeDeps: Object.freeze(Object.keys(VR_TOUR_DEPENDENCIES)),
  buildRuntime: () => `<script lang="ts">${VR_TOUR_RUNTIME_SOURCE}</script>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: TourConfig; panoramaUrl?: unknown; panoramaBound?: boolean }>()
const host = ref<HTMLDivElement | null>(null)
let cleanup: (() => void) | undefined
const refresh = () => {
  cleanup?.()
  cleanup = host.value ? mountVRTour(host.value, props.config, props.panoramaUrl, props.panoramaBound === true) : undefined
}
onMounted(refresh)
watch(() => [JSON.stringify(props.config), props.panoramaUrl, props.panoramaBound], refresh, { flush: 'sync' })
onBeforeUnmount(() => cleanup?.())
</script>
<template><div ref="host" v-bind="$attrs" /></template>
`
})
