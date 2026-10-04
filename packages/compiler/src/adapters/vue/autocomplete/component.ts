export const VUE_AUTOCOMPLETE_COMPONENT_FILE =
  'src/components/open-pencil/OpenPencilAutocomplete.vue'

export function buildVueAutocompleteComponent(microfrontend = false): string {
  const portalImport = microfrontend
    ? "import { microfrontendPortalTarget } from '../../__microfrontend-context'\n"
    : ''
  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, useAttrs, watch } from 'vue'
import { mountAutocomplete, type AutocompleteConfig } from '../../lib/open-pencil-autocomplete'
${portalImport}
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ suggestions: string[]; value?: string; defaultValue?: string; formResetFieldKey?: string }>(), { value: undefined, defaultValue: undefined })
const emit = defineEmits<{(event:'external-rebase'):void}>()
const attrs = useAttrs()
const input = ref<HTMLInputElement | null>(null)
let controller: ReturnType<typeof mountAutocomplete> | undefined
const internal = ref(props.defaultValue ?? '')
let owner: HTMLFormElement | null = null
let disposed = false
let accepted = false
let ownValue: string | undefined, acceptedValue: string | undefined
watch(() => props.value, (value, previous) => {
  if (value === previous) return
  const next = String(value ?? props.defaultValue ?? '')
  const own = ownValue === next || acceptedValue === next
  ownValue = undefined; acceptedValue = undefined
  if (!own) emit('external-rebase')
})
function remember(event: Event) {
  ownValue = (event.target as HTMLInputElement).value
  if (props.value === undefined) internal.value = ownValue
}
function reset(event: Event) { accepted = false; queueMicrotask(() => {
  if (disposed || accepted || event.defaultPrevented || !input.value) return
  if (props.value === undefined) internal.value = props.defaultValue ?? ''
  input.value.value = props.value ?? internal.value
  controller?.update(config())
}) }
function acceptedReset(event: Event) {
  const key = props.formResetFieldKey
  const values = (event as CustomEvent<{values?:Record<string,unknown>}>).detail?.values
  if (!key || !values || !Object.prototype.hasOwnProperty.call(values,key) || !input.value) return
  const next = values[key]
  if (typeof next !== 'string') return
  accepted = true
  acceptedValue = next
  input.value.value = next
  controller?.update(config())
}
function refresh() {
  if (!input.value) return
  input.value.defaultValue = props.defaultValue ?? ''
  if (owner !== input.value.form) {
    owner?.removeEventListener('reset', reset); owner?.removeEventListener('__openPencilFormResetAccepted',acceptedReset)
    owner = input.value.form; owner?.addEventListener('reset', reset); owner?.addEventListener('__openPencilFormResetAccepted',acceptedReset)
  }
  controller?.update(config())
}
function config(): AutocompleteConfig {
  return {
    suggestions: props.suggestions,
    ${microfrontend ? 'portalRoot: microfrontendPortalTarget() ?? undefined,' : ''}
    onSelect(value) {
      const element = input.value
      const win = element?.ownerDocument.defaultView
      if (!element || !win || element.disabled || element.readOnly) return
      element.value = value
      element.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }))
      element.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }))
    }
  }
}
onMounted(() => { if (input.value) controller = mountAutocomplete(input.value, config()); refresh() })
onUpdated(refresh)
onBeforeUnmount(() => { disposed = true; owner?.removeEventListener('reset', reset); owner?.removeEventListener('__openPencilFormResetAccepted',acceptedReset);controller?.destroy() })
</script>
<template>
  <input v-bind="attrs" ref="input" :value="value ?? internal" @input="remember" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" autocomplete="off" />
</template>
`
}
