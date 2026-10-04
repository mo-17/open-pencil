import { MAP_DEPENDENCIES, MAP_RUNTIME_SOURCE } from '#compiler/adapters/map/source'

import { MAP_MODULE_TYPE, MAP_PLUGIN_ID } from '@open-pencil/core/plugins'

import type { VueModuleAdapter } from './types'

export const MAP_VUE_MODULE_ADAPTER: VueModuleAdapter = Object.freeze({
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  componentName: 'OpenPencilMap',
  runtimePath: 'src/__openpencil_map.vue',
  importPath: '../__openpencil_map.vue',
  dependencies: MAP_DEPENDENCIES,
  optimizeDeps: Object.freeze(Object.keys(MAP_DEPENDENCIES)),
  buildRuntime: () => `<script lang="ts">${MAP_RUNTIME_SOURCE}</script>
<script setup lang="ts">
import { computed, normalizeClass, normalizeStyle, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ config: OpenPencilMapConfig }>()
const attrs = useAttrs()
const container = ref<HTMLDivElement | null>(null)
const failed = ref(false)
const serializedConfig = computed(() => serializeOpenPencilMapConfig(props.config))
const hostStyle = computed(() => {
  const normalized = normalizeStyle([attrs.style])
  const style = normalized && typeof normalized === 'object' ? normalized : {}
  const positioned = normalizeClass(attrs.class).split(' ').some(token => ['absolute', 'fixed', 'relative', 'sticky'].includes(token))
  return positioned || (style?.position && style.position !== 'static') ? style : { ...style, position: 'relative' }
})
let cleanup: (() => void) | undefined
function refresh() {
  cleanup?.()
  cleanup = undefined
  failed.value = false
  if (container.value) cleanup = mountOpenPencilMap(container.value, serializedConfig.value, () => { failed.value = true })
}
onMounted(refresh)
watch(serializedConfig, refresh, { flush: 'sync' })
onBeforeUnmount(() => { cleanup?.(); cleanup = undefined })
</script>
<template>
  <div v-bind="$attrs" data-openpencil-map="" :style="hostStyle">
    <div ref="container" style="height:100%;inset:0;position:absolute;width:100%" />
    <div v-if="failed" role="status" style="align-items:center;background:#e5e7eb;color:#4b5563;display:flex;inset:0;justify-content:center;min-height:120px;position:absolute">Map unavailable</div>
    <slot />
  </div>
</template>
`
})
