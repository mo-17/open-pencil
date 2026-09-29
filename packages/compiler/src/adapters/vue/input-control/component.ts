export const VUE_INPUT_CONTROL_COMPONENT_FILE =
  'src/components/open-pencil/OpenPencilInputControl.vue'

export function buildVueInputControlComponent(): string {
  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, useAttrs, type StyleValue } from 'vue'
import { mountInputControl, listenInputReset, inputControlCSS, type InputControlConfig } from '../../lib/open-pencil-input-control'
defineOptions({inheritAttrs:false})
const props = withDefaults(defineProps<{config:InputControlConfig;value?:string | number;defaultValue?:string | number}>(),{value:undefined,defaultValue:undefined})
const attrs = useAttrs(), input = ref<HTMLInputElement | null>(null), wrapper = ref<HTMLSpanElement | null>(null), internal = ref(String(props.defaultValue ?? ''))
let controller: ReturnType<typeof mountInputControl> | undefined, owner: HTMLFormElement | null = null, unbindReset: (() => void) | undefined
function inputAttrs() { return Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style' && key !== 'type' && key !== 'data-node-id')) }
function placeholder(): string | undefined { return typeof attrs.placeholder === 'string' ? attrs.placeholder : props.config.kind === 'color' ? '—' : undefined }
function remember(event: Event) { if (props.value === undefined) internal.value = (event.target as HTMLInputElement).value }
function reset() {
  if (!input.value) return
  if (props.value === undefined) internal.value = String(props.defaultValue ?? '')
  input.value.value = String(props.value ?? internal.value); controller?.reset()
}
function refresh() {
  const element = input.value
  if (!element) return
  // Native reset may finish after a reset-listener microtask. Its default must
  // therefore agree with controlled state, as React's native input already does.
  element.defaultValue = String(props.value ?? props.defaultValue ?? '')
  if (owner !== element.form) { unbindReset?.(); owner=element.form; unbindReset=listenInputReset(element,reset) }
  controller?.update(props.config,attrs.type as InputControlConfig['kind'] | undefined)
}
onMounted(() => {
  const element = input.value, host = wrapper.value
  if (!element || !host) return
  controller = mountInputControl(host,element,props.config,value => {
    const win=element.ownerDocument.defaultView
    if (!win || element.disabled || (props.config.kind === 'color' ? props.config.readOnly : element.readOnly)) return
    element.value=value
    element.dispatchEvent(new win.Event('input',{bubbles:true,composed:true}))
    element.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}))
  }); refresh()
})
onUpdated(refresh)
onBeforeUnmount(() => { unbindReset?.();controller?.destroy() })
</script>
<template><component is="style">{{inputControlCSS}}</component><span ref="wrapper" :data-op-input-control="config.kind" :data-node-id="attrs['data-node-id']" :class="attrs.class" :style="attrs.style as StyleValue"><input v-bind="inputAttrs()" ref="input" :type="config.kind === 'color' ? 'text' : config.kind" :readonly="config.kind === 'color' ? config.readOnly : attrs.readonly === true || attrs.readonly === '' || attrs.readOnly === true" :pattern="config.kind === 'color' ? '#[0-9a-fA-F]{6}' : typeof attrs.pattern === 'string' ? attrs.pattern : undefined" :placeholder="placeholder()" :value="value ?? internal" @input="remember" /></span></template>
`
}
