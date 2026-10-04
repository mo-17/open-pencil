export const VUE_NUMBER_INPUT_COMPONENT_FILE =
  'src/components/open-pencil/OpenPencilNumberInput.vue'

/** Native INPUT keeps incomplete text in its DOM; Vue owns only the business number. */
export function buildVueNumberInputComponent(): string {
  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUpdated, ref, useAttrs, watch } from 'vue'
import { incompleteNumberMessage, parseNumericDraft } from '../../lib/open-pencil-number-draft'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ value: number; formResetFieldKey?: string }>()
const emit = defineEmits<{ input: [event: Event]; blur: [event: FocusEvent]; 'external-rebase': [] }>()
const attrs = useAttrs()
const input = ref<HTMLInputElement | null>(null)
let priorValue = props.value
let committedValue = props.value
let ownCommit: number | undefined
let uncommittedDraft = false
let owner: HTMLFormElement | null = null

function restoreDraft(element: HTMLInputElement, next: number): void {
  element.value = String(next)
  element.defaultValue = String(next)
  element.setCustomValidity('')
  committedValue = next
  uncommittedDraft = false
  ownCommit = undefined
}

function restore(event: Event): void {
  const element = input.value
  const detail = (event as CustomEvent<{ values?: Record<string, unknown> }>).detail
  const key = props.formResetFieldKey
  const next = key ? detail?.values?.[key] : undefined
  if (!element || !owner || element.form !== owner || typeof next !== 'number' || !Number.isFinite(next)) return
  restoreDraft(element, next)
  priorValue = next
}

function submit(): void {
  const element = input.value
  if (element && element.form === owner && uncommittedDraft && !element.required)
    restoreDraft(element, committedValue)
}

function refreshOwner(): void {
  const form = input.value?.form ?? null
  if (owner === form) return
  owner?.removeEventListener('__openPencilFormResetAccepted', restore)
  owner?.removeEventListener('submit', submit, true)
  owner = form
  if (props.formResetFieldKey) owner?.addEventListener('__openPencilFormResetAccepted', restore)
  owner?.addEventListener('submit', submit, true)
}

function handleInput(event: Event): void {
  const element = event.target
  if (!(element instanceof HTMLInputElement)) return
  ownCommit = parseNumericDraft(element.value, element, event)
  uncommittedDraft = ownCommit === undefined
  if (ownCommit !== undefined) committedValue = ownCommit
  element.setCustomValidity(ownCommit === undefined && element.required && element.value !== ''
    ? incompleteNumberMessage(element)
    : '')
  emit('input', event)
}

function handleBlur(event: FocusEvent): void {
  const element = event.target
  if (element instanceof HTMLInputElement && uncommittedDraft && !element.required)
    restoreDraft(element, committedValue)
  emit('blur', event)
}

watch(() => props.value, (value) => {
  const element = input.value
  if (!element || Object.is(priorValue, value)) return
  const external = !Object.is(ownCommit, value)
  if (external) restoreDraft(element, value)
  element.defaultValue = String(value)
  priorValue = value
  committedValue = value
  ownCommit = undefined
  if (external) emit('external-rebase')
}, { flush: 'post' })

onMounted(() => {
  const element = input.value
  if (!element) return
  element.value = String(props.value)
  element.defaultValue = String(props.value)
  refreshOwner()
})
onUpdated(refreshOwner)
onBeforeUnmount(() => {
  owner?.removeEventListener('__openPencilFormResetAccepted', restore)
  owner?.removeEventListener('submit', submit, true)
})
</script>
<template><input v-bind="attrs" ref="input" :required="attrs.required !== undefined && attrs.required !== false || attrs['aria-required'] === true || attrs['aria-required'] === 'true'" @input="handleInput" @blur="handleBlur" /></template>
`
}
