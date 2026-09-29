export const VUE_SELECT_COMPONENT_FILE = 'src/components/open-pencil/OpenPencilSelect.vue'

export function buildVueSelectComponent(microfrontend: boolean): string {
  const portalImport = microfrontend
    ? "import { microfrontendPortalTarget } from '../../__microfrontend-context'\n"
    : ''
  const portalConfig = microfrontend
    ? '\n    portalRoot: microfrontendPortalTarget() ?? undefined,'
    : ''
  return `<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, useAttrs, watch } from 'vue'
import { mountSelect, type SelectConfig } from '../../lib/open-pencil-select'
${portalImport}
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  options: SelectConfig['options']
  showSearch: boolean
  virtual: boolean
  value?: string | number | boolean | unknown[]
  defaultValue?: string | number | boolean | string[]
  multiple?: boolean
  allowClear?: boolean
  placeholder?: string
  disabled?: boolean
}>(), { value: undefined, defaultValue: undefined })
const attrs = useAttrs()
const trigger = ref<HTMLButtonElement | null>(null)
const select = ref<HTMLSelectElement | null>(null)
let controller: ReturnType<typeof mountSelect> | undefined
let form: HTMLFormElement | null = null
let disposed = false
let selectedValue = defaultSelection()

type SelectValue = string | string[]
function normalized(value: unknown): SelectValue {
  return props.multiple ? Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : [] : String(value ?? '')
}
function defaultSelection(): SelectValue {
  if (props.multiple) return (normalized(props.defaultValue) as string[]).filter(value => props.options.some(option => option.value === value))
  const value = props.defaultValue === undefined ? undefined : String(props.defaultValue)
  return props.options.find((option) => option.value === value)?.value
    ?? props.options.find((option) => !option.disabled)?.value ?? ''
}
function currentValue(): SelectValue {
  if (props.value !== undefined) return normalized(props.value)
  if (props.multiple) {
    selectedValue = (Array.isArray(selectedValue) ? selectedValue : []).filter(value => props.options.some(option => option.value === value))
    return selectedValue
  }
  if (!props.options.some((option) => option.value === selectedValue)) selectedValue = defaultSelection()
  return selectedValue
}

function nativeAttribute(name: string): boolean {
  return name.startsWith('on') || ['name', 'form', 'required', 'autocomplete'].includes(name)
}

function triggerAttrs(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([name]) => !nativeAttribute(name)))
}

function selectAttrs(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(attrs).filter(([name]) => nativeAttribute(name)))
}

// The select owns form/event semantics, while its option DOM remains bounded to the selection.
function syncNative(value: SelectValue): void {
  const element = select.value
  if (!element) return
  const values = Array.isArray(value) ? value : [value]
  const defaults = defaultSelection()
  const initial = Array.isArray(defaults) ? defaults : [defaults]
  const options = props.options.filter(option => values.includes(option.value)).map(selected => {
    const option = element.ownerDocument.createElement('option')
    option.value = selected.value
    option.textContent = selected.label
    option.disabled = selected.disabled === true
    option.defaultSelected = initial.includes(selected.value)
    option.selected = true
    return option
  })
  element.replaceChildren(...options)
  if (!props.multiple) element.value = typeof value === 'string' ? value : ''
}

function dispatchFocus(type: 'focus' | 'blur'): void {
  const element = select.value
  const win = element?.ownerDocument.defaultView
  if (element && win) element.dispatchEvent(new win.FocusEvent(type))
}

function selectValue(value: SelectValue): void {
  const element = select.value
  const win = element?.ownerDocument.defaultView
  if (!element || !win || props.disabled) return
  if (typeof value === 'string' && !props.options.some((option) => option.value === value && !option.disabled)) return
  selectedValue = value
  syncNative(value)
  element.dispatchEvent(new win.Event('change', { bubbles: true }))
  void nextTick(refresh)
}

function forwardClick(event: MouseEvent): void {
  event.stopPropagation()
  const element = select.value
  const win = element?.ownerDocument.defaultView
  if (element && win && !props.disabled) {
    element.dispatchEvent(new win.MouseEvent('click', {
      bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey, button: event.button,
      clientX: event.clientX, clientY: event.clientY
    }))
  }
}

function invalid(event: Event): void {
  event.preventDefault()
  trigger.value?.focus()
}

function config(): SelectConfig {
  return {
    options: props.options,
    showSearch: props.showSearch,
    virtual: props.virtual,
    multiple: props.multiple,
    allowClear: props.allowClear,
    placeholder: props.placeholder,
    value: currentValue(),
    disabled: props.disabled,${portalConfig}
    onSelect: selectValue,
    onFocus: () => dispatchFocus('focus'),
    onBlur: () => dispatchFocus('blur')
  }
}

function reset(event: Event): void {
  queueMicrotask(() => {
    if (disposed || event.defaultPrevented) return
    selectedValue = defaultSelection()
    refresh()
  })
}

function refresh(): void {
  if (disposed || !select.value) return
  syncNative(currentValue())
  controller?.update(config())
  if (form !== select.value.form) {
    form?.removeEventListener('reset', reset)
    form = select.value.form
    form?.addEventListener('reset', reset)
  }
}

onMounted(() => {
  if (!trigger.value || !select.value) return
  syncNative(currentValue())
  controller = mountSelect(trigger.value, select.value, config())
  refresh()
})
watch(() => [props.options, props.value, props.disabled, props.showSearch, props.virtual, props.multiple], refresh, {
  deep: true, flush: 'post'
})
onUpdated(refresh)
onBeforeUnmount(() => {
  disposed = true
  form?.removeEventListener('reset', reset)
  controller?.destroy()
})
</script>

<template>
  <button ref="trigger" v-bind="triggerAttrs()" type="button" :disabled="disabled" :aria-required="attrs.required === '' || attrs.required === true || attrs['aria-required'] === true || attrs['aria-required'] === 'true' ? 'true' : undefined" @click="forwardClick"></button>
  <select ref="select" v-bind="selectAttrs()" :multiple="multiple" :disabled="disabled" tabindex="-1" aria-hidden="true" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;pointer-events:none" @invalid="invalid"></select>
</template>
`
}
