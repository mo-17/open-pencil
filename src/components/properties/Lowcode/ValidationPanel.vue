<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { usePresenceTarget } from '@/app/editor/presence/use-presence-target'
import { useSectionUI } from '@/components/ui/section'

import ValidationFieldEditor from './ValidationFieldEditor.vue'

type ValidationMethod = 'GET' | 'POST'
type AsyncMode = 'url' | 'urlExpr'

interface ValidationMessages {
  required?: string
  pattern?: string
  minLength?: string
  maxLength?: string
  min?: string
  max?: string
  custom?: string
}

interface AsyncValidation {
  url?: string
  urlExpr?: string
  method?: ValidationMethod
  message?: string
}

interface FieldValidation {
  required?: boolean
  pattern?: string
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  customExpr?: string
  async?: AsyncValidation
  messages?: ValidationMessages
}

interface FormValidationSummary {
  enabled?: boolean
  title?: string
}

type Props = Record<string, unknown>

const FIELD_TYPES = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'RADIO',
  'DATEPICKER',
  'CHECKBOX',
  'SWITCH'
])

const editor = useEditorStore()
const sectionCls = useSectionUI()
const { panels } = useI18n()
const { selectedNode } = useSelectionState()
const presence = usePresenceTarget('interactiveProps', () => selectedNode.value?.id)

const ip = useSceneComputed<Props>(() => (selectedNode.value?.interactiveProps ?? {}) as Props)

const owner = useSceneComputed(() => {
  const id = selectedNode.value?.id
  return id ? editor.graph.getNode(id) : undefined
})
function commitControlledValidation(value: JSONObject, target: SceneNode | undefined) {
  if (
    !target ||
    target !== owner.value ||
    editor.graph.getNode(target.id) !== target ||
    !editor.state.selectedIds.has(target.id) ||
    editor.state.selectedIds.size !== 1
  )
    return
  const nextIp = { ...ip.value }
  if (Object.keys(value).length) nextIp.validation = value
  else Reflect.deleteProperty(nextIp, 'validation')
  commitInteractiveProps(nextIp)
}

const isField = computed(() => FIELD_TYPES.has(selectedNode.value?.type ?? ''))
const isForm = computed(() => selectedNode.value?.type === 'FORM')
const hasValueBinding = computed(() => {
  const kind = selectedNode.value?.bindings?.value?.kind
  return kind === 'docState' || kind === 'ref'
})

const validationRecord = computed<JSONObject>(() => {
  const raw = selectedNode.value?.interactiveProps?.validation
  return isPlainObject(raw) ? raw : {}
})
const validation = computed<FieldValidation>(() =>
  isPlainObject(ip.value.validation) ? (ip.value.validation as FieldValidation) : {}
)

const summary = computed<FormValidationSummary>(() => {
  const raw = ip.value.validationSummary
  if (raw === true) return { enabled: true }
  return isPlainObject(raw) ? (raw as FormValidationSummary) : {}
})

const asyncEnabled = computed(() => isPlainObject(validation.value.async))
const asyncConfig = computed<AsyncValidation>(() =>
  isPlainObject(validation.value.async) ? (validation.value.async as AsyncValidation) : {}
)
const asyncMode = computed<AsyncMode>(() => (asyncConfig.value.urlExpr ? 'urlExpr' : 'url'))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function commitInteractiveProps(next: Props): void {
  const node = selectedNode.value
  if (!node) return
  editor.updateNodeWithUndo(
    node.id,
    { interactiveProps: next as JSONObject },
    isForm.value ? 'Update validation summary' : 'Update validation'
  )
}

function commitField(nextValidation: FieldValidation): void {
  const nextIp: Props = { ...ip.value }
  const cleaned = cleanValidation(nextValidation)
  if (Object.keys(cleaned).length === 0) Reflect.deleteProperty(nextIp, 'validation')
  else nextIp.validation = cleaned
  commitInteractiveProps(nextIp)
}

function commitSummary(nextSummary: FormValidationSummary): void {
  const nextIp: Props = { ...ip.value }
  if (nextSummary.enabled !== true) {
    Reflect.deleteProperty(nextIp, 'validationSummary')
  } else {
    nextIp.validationSummary = {
      enabled: true,
      ...(nextSummary.title && nextSummary.title.trim() !== '' ? { title: nextSummary.title } : {})
    }
  }
  commitInteractiveProps(nextIp)
}

function cleanValidation(input: FieldValidation): FieldValidation {
  const next: FieldValidation = { ...input }
  if (next.required !== true) Reflect.deleteProperty(next, 'required')
  for (const key of ['pattern', 'customExpr'] as const) {
    if (!next[key] || next[key]?.trim() === '') Reflect.deleteProperty(next, key)
  }
  for (const key of ['minLength', 'maxLength', 'min', 'max'] as const) {
    if (next[key] === undefined || !Number.isFinite(next[key])) Reflect.deleteProperty(next, key)
  }
  if (next.messages) {
    const messages = Object.fromEntries(
      Object.entries(next.messages).filter(([, value]) => value.trim() !== '')
    ) as ValidationMessages
    if (Object.keys(messages).length > 0) next.messages = messages
    else Reflect.deleteProperty(next, 'messages')
  }
  if (next.async) {
    const async = cleanAsync(next.async)
    if (async) next.async = async
    else Reflect.deleteProperty(next, 'async')
  }
  return next
}

function cleanAsync(input: AsyncValidation): AsyncValidation | undefined {
  const method = input.method === 'GET' ? 'GET' : 'POST'
  const url = input.url?.trim()
  const urlExpr = input.urlExpr?.trim()
  const message = input.message?.trim()
  const next: AsyncValidation = { method }
  if (url) next.url = url
  if (urlExpr) next.urlExpr = urlExpr
  if (message) next.message = message
  return next.url || next.urlExpr || next.message ? next : { method }
}

function setAsyncEnabled(checked: boolean): void {
  const next = { ...validation.value }
  if (checked) next.async = { method: 'POST' }
  else Reflect.deleteProperty(next, 'async')
  commitField(next)
}

function setAsyncMode(mode: AsyncMode): void {
  const nextAsync: AsyncValidation = {
    ...asyncConfig.value,
    method: asyncConfig.value.method ?? 'POST'
  }
  if (mode === 'url') Reflect.deleteProperty(nextAsync, 'urlExpr')
  else Reflect.deleteProperty(nextAsync, 'url')
  commitField({ ...validation.value, async: nextAsync })
}

function setAsyncText(key: 'url' | 'urlExpr' | 'message', value: string): void {
  commitField({
    ...validation.value,
    async: { ...asyncConfig.value, [key]: value, method: asyncConfig.value.method ?? 'POST' }
  })
}

function setAsyncMethod(value: string): void {
  commitField({
    ...validation.value,
    async: {
      ...asyncConfig.value,
      method: value === 'GET' ? 'GET' : 'POST'
    }
  })
}

function setSummaryEnabled(checked: boolean): void {
  commitSummary({ ...summary.value, enabled: checked })
}

function setSummaryTitle(value: string): void {
  commitSummary({ ...summary.value, enabled: true, title: value })
}
</script>

<template>
  <div
    v-if="isField || isForm"
    data-test-id="lowcode-validation"
    :class="sectionCls.wrapper"
    @focusin="presence.onFocusIn"
    @focusout="presence.onFocusOut"
  >
    <label class="mb-1.5 block text-[11px] text-muted">Validation</label>

    <template v-if="isForm">
      <label class="flex items-center gap-2 text-[11px] text-surface">
        <input
          type="checkbox"
          :checked="summary.enabled === true"
          data-test-id="lowcode-validation-summary-enabled"
          class="size-3.5 accent-accent"
          @change="setSummaryEnabled(($event.target as HTMLInputElement).checked)"
        />
        Error summary
      </label>
      <input
        v-if="summary.enabled === true"
        :value="summary.title ?? ''"
        data-test-id="lowcode-validation-summary-title"
        spellcheck="false"
        placeholder="Please fix the highlighted fields."
        class="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
        @change="setSummaryTitle(($event.target as HTMLInputElement).value)"
      />
    </template>

    <template v-else>
      <ValidationFieldEditor
        :model-value="validationRecord"
        :owner="owner"
        @commit="commitControlledValidation"
      />

      <label class="mt-2 flex items-center gap-2 text-[11px] text-surface">
        <input
          type="checkbox"
          :checked="asyncEnabled"
          data-test-id="lowcode-validation-async-enabled"
          class="size-3.5 accent-accent"
          @change="setAsyncEnabled(($event.target as HTMLInputElement).checked)"
        />
        Remote validator
      </label>

      <div v-if="asyncEnabled" class="mt-1 flex flex-col gap-1">
        <div class="grid grid-cols-[88px_1fr] gap-1">
          <select
            :value="asyncConfig.method ?? 'POST'"
            data-test-id="lowcode-validation-async-method"
            class="rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
            @change="setAsyncMethod(($event.target as HTMLSelectElement).value)"
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
          <select
            :value="asyncMode"
            data-test-id="lowcode-validation-async-mode"
            class="rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
            @change="setAsyncMode(($event.target as HTMLSelectElement).value as AsyncMode)"
          >
            <option value="url">Static URL</option>
            <option value="urlExpr">URL expression</option>
          </select>
        </div>
        <input
          v-if="asyncMode === 'url'"
          :value="asyncConfig.url ?? ''"
          data-test-id="lowcode-validation-async-url"
          spellcheck="false"
          placeholder="/api/check-email"
          class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="setAsyncText('url', ($event.target as HTMLInputElement).value)"
        />
        <input
          v-else
          :value="asyncConfig.urlExpr ?? ''"
          data-test-id="lowcode-validation-async-url-expr"
          spellcheck="false"
          placeholder="validatorUrl"
          class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="setAsyncText('urlExpr', ($event.target as HTMLInputElement).value)"
        />
        <input
          :value="asyncConfig.message ?? ''"
          data-test-id="lowcode-validation-async-message"
          spellcheck="false"
          placeholder="Remote validation failed"
          class="w-full rounded border border-border bg-input px-2 py-1 text-xs text-surface outline-none focus:border-accent"
          @change="setAsyncText('message', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <p v-if="!hasValueBinding" class="mt-1 text-[10px] text-muted">
        {{ panels.lowcodeValidationBindingHint }}
      </p>
    </template>
  </div>
</template>
