export const VUE_INPUT_CONTROL_COMPONENT_FILE =
  'src/components/open-pencil/OpenPencilInputControl.vue'

export function buildVueInputControlComponent(): string {
  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, useAttrs, watch, type StyleValue } from 'vue'
import { mountInputControl, listenInputReset, inputControlCSS, type InputControlConfig } from '../../lib/open-pencil-input-control'
import { parseNumericDraft, incompleteNumberMessage } from '../../lib/open-pencil-number-draft'
defineOptions({inheritAttrs:false})
const props = withDefaults(defineProps<{config:InputControlConfig;value?:string | number;defaultValue?:string | number;formResetFieldKey?:string}>(),{value:undefined,defaultValue:undefined})
const emit = defineEmits<{(event:'external-rebase'):void}>()
const attrs = useAttrs(), input = ref<HTMLInputElement | null>(null), wrapper = ref<HTMLSpanElement | null>(null), internal = ref(String(props.defaultValue ?? ''))
let controller: ReturnType<typeof mountInputControl> | undefined, owner: HTMLFormElement | null = null, unbindReset: (() => void) | undefined
const initialNumber = String(props.value ?? props.defaultValue ?? '')
let ownNumber: number | undefined, uncommitted = false, accepted = false
let ownValue: string | undefined, acceptedValue: string | undefined
function inputAttrs() { return Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style' && key !== 'type' && key !== 'data-node-id')) }
function placeholder(): string | undefined { return typeof attrs.placeholder === 'string' ? attrs.placeholder : props.config.kind === 'color' ? '—' : undefined }
function nativeInputProps() {
  const common = {
    type: props.config.kind === 'color' ? 'text' : props.config.kind,
    required: props.config.kind === 'number' ? attrs.required === true || attrs.required === '' || attrs['aria-required'] === true || attrs['aria-required'] === 'true' : attrs.required === true || attrs.required === '',
    readonly: props.config.kind === 'color' ? props.config.readOnly : attrs.readonly === true || attrs.readOnly === true || attrs.readonly === '',
    pattern: props.config.kind === 'color' ? '#[0-9a-fA-F]{6}' : typeof attrs.pattern === 'string' ? attrs.pattern : undefined,
    placeholder: placeholder()
  }
  // The constant initial value serves SSR without patching a live numeric draft on unrelated renders.
  return props.config.kind === 'number' ? { ...common, value: initialNumber } : { ...common, value: props.value ?? internal.value }
}
function numberRequired(element: HTMLInputElement) { return element.required || element.getAttribute('aria-required') === 'true' }
watch(() => props.value, (value, previous) => {
  if (value === previous) return
  const next = String(value ?? props.defaultValue ?? '')
  const own = props.config.kind === 'number' ? typeof value === 'number' && ownNumber === value : ownValue === next
  const acceptedCommit = acceptedValue === next
  ownValue = undefined; acceptedValue = undefined
  if (own || acceptedCommit) {
    ownNumber = undefined
    if (props.config.kind === 'number' && input.value) input.value.defaultValue = next
    return
  }
  ownNumber = undefined
  uncommitted = false
  if (props.config.kind === 'number' && input.value) {
    input.value.value = next
    input.value.defaultValue = input.value.value
    input.value.setCustomValidity('')
  }
  emit('external-rebase')
})
watch(() => props.config.kind, kind => { if (kind === 'number' && input.value) input.value.value = String(props.value ?? props.defaultValue ?? '') })
function remember(event: Event) {
  const element = event.target as HTMLInputElement
  if (props.config.kind === 'number') {
    ownNumber = parseNumericDraft(element.value,element,event)
    ownValue = ownNumber === undefined ? undefined : String(ownNumber)
    uncommitted = ownNumber === undefined
    element.setCustomValidity(uncommitted && numberRequired(element) && element.value !== '' ? incompleteNumberMessage(element) : '')
  } else ownValue = element.value
  if (props.value === undefined) internal.value = element.value
}
function restoreBusinessNumber() {
  const element = input.value
  if (!element || props.config.kind !== 'number') return
  element.value = String(props.value ?? props.defaultValue ?? '')
  element.defaultValue = element.value
  ownNumber = undefined
  uncommitted = false
  element.setCustomValidity('')
}
function blur(event: FocusEvent) { if (props.config.kind === 'number' && uncommitted && !numberRequired(event.target as HTMLInputElement)) restoreBusinessNumber() }
function submitting() { if (props.config.kind === 'number' && uncommitted && input.value && !numberRequired(input.value)) restoreBusinessNumber() }
function reset() {
  if (!input.value || accepted) return
  if (props.value === undefined) internal.value = String(props.defaultValue ?? '')
  input.value.value = String(props.value ?? internal.value); controller?.reset()
  if (props.config.kind === 'number') { ownNumber = undefined; uncommitted = false; input.value.setCustomValidity('') }
}
function acceptedReset(event: Event) {
  const key = props.formResetFieldKey
  const values = (event as CustomEvent<{values?:Record<string,unknown>}>).detail?.values
  if (!key || !values || !Object.prototype.hasOwnProperty.call(values,key) || !input.value) return
  const next = values[key]
  if (typeof next !== 'number' && typeof next !== 'string') return
  accepted = true
  acceptedValue = String(next)
  input.value.value = String(next)
  if (props.config.kind === 'number') { ownNumber = undefined; uncommitted = false; input.value.defaultValue = String(next); input.value.setCustomValidity('') }
  controller?.reset()
}
function refresh() {
  const element = input.value
  if (!element) return
  // Native reset may finish after a reset-listener microtask. Its default must
  // therefore agree with controlled state, as React's native input already does.
  element.defaultValue = String(props.value ?? props.defaultValue ?? '')
  if (owner !== element.form) {
    unbindReset?.();owner?.removeEventListener('reset',startingReset);owner?.removeEventListener('submit',submitting,true);owner?.removeEventListener('__openPencilFormResetAccepted',acceptedReset)
    owner=element.form;owner?.addEventListener('reset',startingReset);owner?.addEventListener('submit',submitting,true);owner?.addEventListener('__openPencilFormResetAccepted',acceptedReset)
    unbindReset=listenInputReset(element,reset)
  }
  controller?.update(props.config,attrs.type as InputControlConfig['kind'] | undefined)
}
function startingReset() { accepted = false }
onMounted(() => {
  const element = input.value, host = wrapper.value
  if (!element || !host) return
  if (props.config.kind === 'number') element.value = String(props.value ?? props.defaultValue ?? '')
  controller = mountInputControl(host,element,props.config,value => {
    const win=element.ownerDocument.defaultView
    if (!win || element.disabled || (props.config.kind === 'color' ? props.config.readOnly : element.readOnly)) return
    element.value=value
    element.dispatchEvent(new win.Event('input',{bubbles:true,composed:true}))
    element.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}))
  }); refresh()
})
onUpdated(refresh)
onBeforeUnmount(() => { unbindReset?.();owner?.removeEventListener('reset',startingReset);owner?.removeEventListener('submit',submitting,true);owner?.removeEventListener('__openPencilFormResetAccepted',acceptedReset);controller?.destroy() })
</script>
<template><component is="style">{{inputControlCSS}}</component><span ref="wrapper" :data-op-input-control="config.kind" :data-node-id="attrs['data-node-id']" :class="attrs.class" :style="attrs.style as StyleValue"><input v-bind="{...inputAttrs(),...nativeInputProps()}" ref="input" @input="remember" @blur="blur" /></span></template>
`
}
