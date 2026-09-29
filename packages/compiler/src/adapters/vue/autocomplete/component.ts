export const VUE_AUTOCOMPLETE_COMPONENT_FILE =
  'src/components/open-pencil/OpenPencilAutocomplete.vue'

export function buildVueAutocompleteComponent(microfrontend = false): string {
  const portalImport = microfrontend
    ? "import { microfrontendPortalTarget } from '../../__microfrontend-context'\n"
    : ''
  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, useAttrs } from 'vue'
import { mountAutocomplete, type AutocompleteConfig } from '../../lib/open-pencil-autocomplete'
${portalImport}
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ suggestions: string[]; value?: string; defaultValue?: string }>(), { value: undefined, defaultValue: undefined })
const attrs = useAttrs()
const input = ref<HTMLInputElement | null>(null)
let controller: ReturnType<typeof mountAutocomplete> | undefined
const internal = ref(props.defaultValue ?? '')
let owner: HTMLFormElement | null = null
let disposed = false
function remember(event: Event) { if (props.value === undefined) internal.value = (event.target as HTMLInputElement).value }
function reset(event: Event) { queueMicrotask(() => {
  if (disposed || event.defaultPrevented || !input.value) return
  if (props.value === undefined) internal.value = props.defaultValue ?? ''
  input.value.value = props.value ?? internal.value
  controller?.update(config())
}) }
function refresh() {
  if (!input.value) return
  input.value.defaultValue = props.defaultValue ?? ''
  if (owner !== input.value.form) { owner?.removeEventListener('reset', reset); owner = input.value.form; owner?.addEventListener('reset', reset) }
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
onBeforeUnmount(() => { disposed = true; owner?.removeEventListener('reset', reset); controller?.destroy() })
</script>
<template>
  <input v-bind="attrs" ref="input" :value="value ?? internal" @input="remember" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" autocomplete="off" />
</template>
`
}
