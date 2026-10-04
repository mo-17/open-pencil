export const REACT_PAGE_VIEWPORT_FILE = 'src/components/_open-pencil-page-viewport.tsx'
export const VUE_PAGE_VIEWPORT_FILE = 'src/components/_open-pencil-page-viewport.vue'

import type { IRTree } from '#compiler/ir/types'

import { pageViewportStyleOptions } from './project'

export function reactPageViewportBoundary(ir: IRTree, prefix: string, attrs: string) {
  const config = ir.pageViewport?.mode !== 'fixed' ? ir.pageViewport : undefined
  return config
    ? {
        import: `import __OpenPencilPageViewport from '${prefix}_open-pencil-page-viewport'\n`,
        open: `<__OpenPencilPageViewport config={${JSON.stringify(config)}} frameCSS={${JSON.stringify(pageViewportStyleOptions(ir).frameCSS)}} styleKey=${JSON.stringify(pageViewportStyleOptions(ir).styleKey)}${attrs}>`,
        close: '</__OpenPencilPageViewport>'
      }
    : { import: '', open: `<div${attrs}>`, close: '</div>' }
}

export function reactPageViewportSource(): string {
  return `import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react'
import { mountPageViewport, pageViewportHostStyle, pageViewportCanvasStyle, pageViewportContentStyle, type PageViewportConfig } from '../lib/open-pencil-page-viewport'
export default function OpenPencilPageViewport({config,frameCSS,styleKey,children,...attrs}: HTMLAttributes<HTMLDivElement> & {config:PageViewportConfig;frameCSS?:string;styleKey?:string}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null)
  const {mode,designWidth,designHeight,originX,originY} = config
  useEffect(() => {
    if (host.current && canvas.current) return mountPageViewport(host.current,canvas.current,{version:1,mode,designWidth,designHeight,originX,originY})
  },[mode,designWidth,designHeight,originX,originY])
  return <div ref={host} data-op-page-viewport-host={mode} style={pageViewportHostStyle(config) as CSSProperties}>
    {frameCSS ? <style>{frameCSS}</style> : null}
    <div {...attrs} ref={canvas} data-op-page-viewport={mode} data-op-page-viewport-style-key={styleKey} style={{...attrs.style,...pageViewportCanvasStyle(config)} as CSSProperties}>
      {mode === 'fit-width' ? <div data-op-page-origin="" style={pageViewportContentStyle(config) as CSSProperties}>{children}</div> : children}
    </div>
  </div>
}
`
}

export function vuePageViewportSource(): string {
  return `<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, useAttrs, watch, type StyleValue } from 'vue'
import { mountPageViewport, pageViewportHostStyle, pageViewportCanvasStyle, pageViewportContentStyle, type PageViewportConfig } from '../lib/open-pencil-page-viewport'
defineOptions({inheritAttrs:false})
const props = defineProps<{config:PageViewportConfig;frameCSS?:string;styleKey?:string}>()
const attrs = useAttrs(), host = ref<HTMLDivElement | null>(null), canvas = ref<HTMLElement | null>(null)
let unmount: (() => void) | undefined
function mount() {
  unmount?.()
  if (host.value && canvas.value) unmount = mountPageViewport(host.value,canvas.value,props.config)
}
onMounted(mount)
watch(() => props.config, mount)
onBeforeUnmount(() => { unmount?.(); unmount = undefined })
</script>
<template>
  <div ref="host" :data-op-page-viewport-host="config.mode" :style="pageViewportHostStyle(config)">
    <component is="style" v-if="frameCSS">{{frameCSS}}</component>
    <main v-bind="attrs" ref="canvas" :data-op-page-viewport="config.mode" :data-op-page-viewport-style-key="styleKey" :style="[attrs.style as StyleValue,pageViewportCanvasStyle(config)]">
      <div v-if="config.mode === 'fit-width'" data-op-page-origin="" :style="pageViewportContentStyle(config)"><slot /></div>
      <slot v-else />
    </main>
  </div>
</template>
`
}
